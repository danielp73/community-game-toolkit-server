const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const multer = require("multer");
const fs = require("fs");
const sharp = require("sharp");
const convertHeic = require("heic-convert");

const { audioExtension, saveAudio } = require("./audio-uploads");

const { prepareSceneAudio, copySceneAudio } = require("./scene-audio");

const app = express();

const PORT = Number(process.env.PORT) || 8000;
const SERVER_URL = process.env.SERVER_URL || `https://share.communitygametoolkit.org`;
const PHOTOROOM_API_KEY = process.env.PHOTOROOM_API_KEY || "";
const PHOTOROOM_SEGMENT_URL = "https://sdk.photoroom.com/v1/segment";

// DEVELOPMENT ONLY — set this to false (or remove this block) before deploying
// to production. It creates a fresh session every time this server starts, so
// local testing does not require a curl command or dashboard interaction.
const CREATE_TEST_SESSION_ON_STARTUP = true;

// Change this one value to set the maximum width or height of every image that
// enters the editor. Images retain their original shape and are never enlarged.
const MAX_IMAGE_DIMENSION = 1000;

// iPhones usually upload HEIC files with one of these MIME types. The filename
// extension check below is a fallback for browsers that omit or mislabel it.
const HEIC_MIME_TYPES = new Set([
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence"
]);

// Multer writes incoming files here while they are being processed. This keeps
// original camera files out of Node's memory and outside the public /uploads
// directory. Each file is deleted as soon as its request finishes.
const TEMP_UPLOAD_DIRECTORY = path.join(__dirname, "tmp");
fs.mkdirSync(TEMP_UPLOAD_DIRECTORY, { recursive: true });

// Published scene bundles are served automatically by the existing /public
// static-file middleware at /scenes/<scene-id>/scene.json.
const PUBLISHED_SCENES_DIRECTORY = path.join(__dirname, "public", "scenes");
fs.mkdirSync(PUBLISHED_SCENES_DIRECTORY, { recursive: true });

// Use the same upload folder for writes, serving, and scene saves. Preserve
// deployments launched by PM2 from a parent directory; no media migration needed.
const UPLOADS_DIRECTORY = path.resolve(process.env.TOOLKIT_UPLOADS_DIRECTORY || "uploads");
fs.mkdirSync(UPLOADS_DIRECTORY, { recursive: true });

const sessions = {};

// Scene publishing can include several base64-encoded PNGs in one JSON request.
// Individual images are still limited and validated by the publishing route.
app.use(express.json({ limit: "50mb" }));

// Store final uploads on disk. These are the images that the user has approved
// in the editor, so they belong in the session's permanent upload folder.
const upload = multer({
    dest: TEMP_UPLOAD_DIRECTORY,
    limits: {
        // A friendly upper limit for mobile camera photos. It also prevents a
        // very large file from exhausting memory during background removal.
        fileSize: 15 * 1024 * 1024,
        files: 1, fields: 0, parts: 2
    },
    fileFilter(req, file, callback) {
        if (file.fieldname === "audio") {
            try { audioExtension(file); callback(null, true); }
            catch (error) { callback(error); }
        } else { imageFileFilter(req, file, callback); }
    }
});

// Keep large temporary editor images on disk rather than in Node's memory. The
// background-removal endpoint deletes this temporary file after it sends the
// resized PNG back to the browser.
const editorUpload = multer({
    dest: TEMP_UPLOAD_DIRECTORY,
    limits: {
        fileSize: 15 * 1024 * 1024
    },
    fileFilter: imageFileFilter
});

// A scene publish contains one JSON manifest plus the PNG files referenced by
// that manifest. Multer stages all files in /tmp until validation succeeds.
const sceneBundleUpload = multer({
    dest: TEMP_UPLOAD_DIRECTORY,
    limits: {
        fileSize: 15 * 1024 * 1024,
        files: 101
    },
    fileFilter: sceneBundleFileFilter
});


//** dashboard
 
// Serve everything inside /public and /uploads
// Published scenes are replaceable content. Prevent browsers and hosting
// proxies from keeping an older scene.json or an older image with the same URL.
app.use("/scenes", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

// The web editor is still under active development. Always revalidate its HTML,
// JavaScript, WebAssembly, and data files so a normal reload uses the latest build.
app.use("/editor", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIRECTORY));


//**create session

app.post("/create-session", (req, res) => {

    const session = createSession();

    console.log("Created session:", session.sessionId);

    res.json(session);

});



//**get list of sessions

app.get("/api/sessions", (req, res) => {
    res.json(Object.values(sessions));
});

// List published scenes for the public homepage. Scene manifests remain the
// source of truth, so republishing automatically updates names and thumbnails.
app.get("/api/scenes", (req, res) => {
    const scenes = [];

    try {
        const sceneDirectories = fs.readdirSync(PUBLISHED_SCENES_DIRECTORY, {
            withFileTypes: true
        });

        for (const directory of sceneDirectories) {
            if (!directory.isDirectory() || !isSafeIdentifier(directory.name)) {
                continue;
            }

            const manifestPath = path.join(
                PUBLISHED_SCENES_DIRECTORY,
                directory.name,
                "scene.json"
            );

            if (!fs.existsSync(manifestPath)) {
                continue;
            }

            try {
                const sceneData = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

                // Older manifests predate this field and remain public for
                // backward compatibility. Only an explicit false hides a scene.
                if (sceneData.isPublic === false) {
                    continue;
                }

                const sceneObjects = Array.isArray(sceneData.objects) ? sceneData.objects : [];
                const thumbnailUrls = sceneObjects
                    .filter(sceneObject => {
                        if (sceneObject?.type !== "image" ||
                            typeof sceneObject.assetUrl !== "string" ||
                            !sceneObject.assetUrl.startsWith("images/")) {
                            return false;
                        }

                        const fileName = sceneObject.assetUrl.slice("images/".length);
                        return isSafePngFileName(fileName) && fs.existsSync(
                            path.join(PUBLISHED_SCENES_DIRECTORY, directory.name, "images", fileName)
                        );
                    })
                    .slice(0, 3)
                    .map(sceneObject =>
                        `/scenes/${encodeURIComponent(directory.name)}/${sceneObject.assetUrl}`
                    );

                const publishedTitle = typeof sceneData.title === "string"
                    ? sceneData.title.trim()
                    : "";

                scenes.push({
                    sceneId: directory.name,
                    title: publishedTitle || directory.name,
                    hasPublishedTitle: Boolean(publishedTitle),
                    imageCount: sceneObjects.filter(object => object?.type === "image").length,
                    thumbnailUrls,
                    viewerUrl: `/viewer/?scene=${encodeURIComponent(directory.name)}`,
                    updatedAt: fs.statSync(manifestPath).mtime.toISOString()
                });
            } catch (error) {
                console.warn(`Skipping unreadable scene ${directory.name}:`, error.message);
            }
        }

        scenes.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
        return res.json(scenes);
    } catch (error) {
        console.error("Could not list published scenes:", error);
        return res.status(500).json({ error: "Published scenes could not be listed." });
    }
});

// Check one user-supplied scene code without including private scenes in the
// public scene list. Codes act as unlisted identifiers for private scenes.
app.get("/api/scenes/:sceneId/status", (req, res) => {
    const sceneId = req.params.sceneId;

    if (!isSafeIdentifier(sceneId)) {
        return res.status(400).json({ error: "Invalid scene ID." });
    }

    const manifestPath = path.join(
        PUBLISHED_SCENES_DIRECTORY,
        sceneId,
        "scene.json"
    );

    return res.json({ exists: fs.existsSync(manifestPath) });
});

//**serve session page

app.get("/session/:id", (req, res) => {

    const id = req.params.id;

    if (!sessions[id]) {

        return res.status(404).send("Unknown session.");

    }

    res.sendFile(path.join(__dirname,
        "public",
        "session.html"));

});

//**serve QR code for a session

app.get("/session/:id/qr", async (req, res) => {

    const session = sessions[req.params.id];

    if (!session) {
        return res.status(404).send("Session not found.");
    }

    try {

        const png = await QRCode.toBuffer(session.sessionURL);

        res.setHeader("Content-Type", "image/png");
        res.send(png);

    } catch (err) {

        console.error(err);
        res.status(500).send("Could not generate QR code.");

    }
});


//**get session info

app.get("/api/session/:id", (req, res) => {

    const session = sessions[req.params.id];

    if (!session) {
        return res.status(404).json({
            error: "Session not found"
        });
    }

    res.json(session);

});


//** upload action

app.post(
    "/api/session/:id/upload",
    (req, res, next) => {
        if (!sessions[req.params.id]) return res.status(404).json({ error: "Session not found." });
        upload.fields([{ name: "image", maxCount: 1 }, { name: "audio", maxCount: 1 }])(req, res, error => {
            const files = Object.values(req.files || {}).flat();
            if (error || files.length !== 1) {
                files.forEach(file => removeTemporaryFile(file.path));
                return res.status(error?.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
                    error: error?.code === "LIMIT_FILE_SIZE" ? "Files must be 15 MB or smaller." : error?.message || "Choose one image or audio file."
                });
            }
            req.file = files[0];
            next();
        });
    },
    async (req, res) => {

        const sessionId = req.params.id;

        if (!sessions[sessionId]) {
            return res.status(404).send("Session not found.");
        }

        if (!req.file) {
            return res.status(400).send("No file uploaded.");
        }

        if (req.file.fieldname === "audio") {
            try {
                const filename = saveAudio(req.file, sessionId, UPLOADS_DIRECTORY);
                return res.json({ success: true, filename });
            } catch (error) {
                return res.status(422).json({ error: error.message });
            } finally { removeTemporaryFile(req.file.path); }
        }

        try {
            // Convert the final, user-approved upload to a consistently sized
            // PNG before saving it. This avoids storing large camera originals.
            const resizedImage = await resizeImage(
                req.file.path,
                req.file.mimetype,
                req.file.originalname
            );

            // Create the session folder if needed.
            const sessionFolder = path.join(UPLOADS_DIRECTORY, sessionId);
            fs.mkdirSync(sessionFolder, { recursive: true });

            // Every processed upload is PNG, regardless of its original format.
            const files = fs.readdirSync(sessionFolder);
            const filename = String(files.length + 1).padStart(6, "0") + ".png";
            const destination = path.join(sessionFolder, filename);

            fs.writeFileSync(destination, resizedImage);
            fs.unlinkSync(req.file.path);

            console.log(`Saved resized image to ${destination}`);

            res.json({
                success: true,
                filename: filename
            });
        } catch (error) {
            // Remove Multer's temporary file when processing fails, rather than
            // leaving unusable uploads behind on the server.
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            console.error("Image resizing failed:", error);
            res.status(422).json({
                error: "We could not process this image. Please try another image."
            });
        }

    }
);

//** remove an image background for the mobile editor

app.post(
    "/api/session/:id/remove-background",
    editorUpload.single("image"),
    async (req, res) => {

        // These logs make production failures easy to pinpoint: whether the
        // request reached Node, the model completed, or the browser disconnected
        // before it received the PNG response.
        const startedAt = Date.now();
        const temporaryFilePath = req.file?.path;

        res.on("finish", () => {
            console.log(
                `[Background removal] Response finished in ${Date.now() - startedAt}ms.`
            );
        });

        res.on("close", () => {
            if (!res.writableEnded) {
                console.warn(
                    `[Background removal] Client disconnected after ${Date.now() - startedAt}ms.`
                );
            }
        });

        // Do not process images for a session that does not exist.
        if (!sessions[req.params.id]) {
            removeTemporaryFile(temporaryFilePath);
            return res.status(404).json({ error: "Session not found." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "Please provide an image." });
        }

        console.log(
            `[Background removal] Received ${req.file.mimetype} image (${req.file.size} bytes).`
        );

        try {
            // Normalize to a compact PNG before calling the AI. This gives the
            // model a known-safe format and ensures it never processes an image
            // larger than MAX_IMAGE_DIMENSION in either direction.
            const resizeStartedAt = Date.now();
            const resizedImage = await resizeImage(
                req.file.path,
                req.file.mimetype,
                req.file.originalname
            );

            console.log(
                `[Background removal] Resize completed in ${Date.now() - resizeStartedAt}ms.`
            );

            if (!PHOTOROOM_API_KEY) {
                return res.status(503).json({
                    error: "Background removal is not configured on this server."
                });
            }

            // PhotoRoom performs the expensive segmentation on its own
            // infrastructure. This server only forwards the already-resized
            // PNG and relays the transparent PNG response to the browser.
            const formData = new FormData();
            formData.append(
                "image_file",
                new Blob([resizedImage], { type: "image/png" }),
                "toolkit-image.png"
            );
            formData.append("format", "png");

            const removalStartedAt = Date.now();
            const photoRoomResponse = await fetch(PHOTOROOM_SEGMENT_URL, {
                method: "POST",
                headers: {
                    "x-api-key": PHOTOROOM_API_KEY
                },
                body: formData,
                signal: AbortSignal.timeout(60000)
            });

            if (!photoRoomResponse.ok) {
                const responseText = await photoRoomResponse.text();
                throw new Error(
                    `PhotoRoom returned ${photoRoomResponse.status}: ${responseText}`
                );
            }

            console.log(
                `[Background removal] PhotoRoom removal completed in ` +
                `${Date.now() - removalStartedAt}ms.`
            );

            const outputConversionStartedAt = Date.now();
            const pngBuffer = Buffer.from(await photoRoomResponse.arrayBuffer());

            console.log(
                `[Background removal] Output conversion completed in ` +
                `${Date.now() - outputConversionStartedAt}ms; ` +
                `sending ${pngBuffer.length} byte PNG.`
            );

            res.set({
                "Content-Type": "image/png",
                "Cache-Control": "no-store"
            });
            res.send(pngBuffer);

        } catch (error) {
            console.error("Background removal failed:", error);
            res.status(500).json({
                error: "We could not remove the background. You can still upload the original image."
            });
        } finally {
            // The original upload is no longer needed once the response has
            // been prepared. Deleting it promptly keeps disk and memory use low.
            removeTemporaryFile(temporaryFilePath);
        }
    }
);

//send list of files for a session
app.get("/api/session/:id/uploads", (req, res) => {

    const sessionId = req.params.id;
    if (!sessions[sessionId]) return res.status(404).json({ error: "Session not found." });

    const folder = path.join(UPLOADS_DIRECTORY, sessionId);

    if (!fs.existsSync(folder)) {
        // Keep the response shape stable before and after the first upload.
        // Both Unity and the WebGL editor expect a MediaList-style object.
        return res.json({ media: [] });
    }

    const files = fs.readdirSync(folder);

    res.json({
        media: files
    });

});

// Publish or replace one complete Toolkit scene bundle. The multipart request
// must contain one "scene" JSON file and zero or more "images" PNG files.
app.post(
    "/api/scenes/:sceneId",
    sceneBundleUpload.fields([
        { name: "scene", maxCount: 1 },
        { name: "images", maxCount: 100 }
    ]),
    (req, res) => {
        const sceneId = req.params.sceneId;
        const sceneFile = req.files?.scene?.[0];
        const imageFiles = req.files?.images || [];
        const temporaryFiles = [sceneFile, ...imageFiles].filter(Boolean);
        let stagingDirectory;

        try {
            if (!isSafeIdentifier(sceneId)) {
                return res.status(400).json({ error: "Invalid scene ID." });
            }

            if (!sceneFile) {
                return res.status(400).json({ error: "The scene.json file is required." });
            }

            let sceneData;

            try {
                sceneData = JSON.parse(fs.readFileSync(sceneFile.path, "utf8"));
            } catch {
                return res.status(400).json({ error: "The scene file is not valid JSON." });
            }

            if (sceneData.sceneId !== sceneId) {
                return res.status(400).json({
                    error: "The URL scene ID does not match scene.json."
                });
            }

            if ((sceneData.objects || []).some(item => item?.type === "audio")) {
                return res.status(400).json({ error: "Use the JSON scene save endpoint for audio scenes." });
            }

            const uploadedImages = new Map();

            for (const imageFile of imageFiles) {
                if (!isSafePngFileName(imageFile.originalname)) {
                    return res.status(400).json({
                        error: `Invalid image filename: ${imageFile.originalname}`
                    });
                }

                if (uploadedImages.has(imageFile.originalname)) {
                    return res.status(400).json({
                        error: `Duplicate image filename: ${imageFile.originalname}`
                    });
                }

                uploadedImages.set(imageFile.originalname, imageFile);
            }

            const sceneObjects = Array.isArray(sceneData.objects) ? sceneData.objects : [];

            for (const sceneObject of sceneObjects) {
                if (sceneObject.type !== "image") {
                    continue;
                }

                if (typeof sceneObject.assetUrl !== "string" ||
                    !sceneObject.assetUrl.startsWith("images/")) {
                    return res.status(400).json({
                        error: `Image ${sceneObject.objectId || "(unknown)"} has an invalid assetUrl.`
                    });
                }

                const imageFileName = sceneObject.assetUrl.slice("images/".length);

                if (!isSafePngFileName(imageFileName) || !uploadedImages.has(imageFileName)) {
                    return res.status(400).json({
                        error: `Missing uploaded image: ${sceneObject.assetUrl}`
                    });
                }
            }

            stagingDirectory = fs.mkdtempSync(
                path.join(TEMP_UPLOAD_DIRECTORY, `scene-${sceneId}-`)
            );
            const stagingImagesDirectory = path.join(stagingDirectory, "images");
            fs.mkdirSync(stagingImagesDirectory, { recursive: true });

            fs.copyFileSync(sceneFile.path, path.join(stagingDirectory, "scene.json"));

            for (const [fileName, imageFile] of uploadedImages) {
                fs.copyFileSync(imageFile.path, path.join(stagingImagesDirectory, fileName));
            }

            const destinationDirectory = path.join(PUBLISHED_SCENES_DIRECTORY, sceneId);
            replaceDirectory(stagingDirectory, destinationDirectory);
            stagingDirectory = undefined;

            const sceneUrl = `${SERVER_URL}/scenes/${sceneId}/scene.json`;
            console.log(`Published scene ${sceneId} to ${destinationDirectory}`);

            return res.json({
                success: true,
                sceneId,
                sceneUrl
            });
        } catch (error) {
            console.error("Scene publishing failed:", error);
            return res.status(500).json({ error: "The scene could not be published." });
        } finally {
            for (const temporaryFile of temporaryFiles) {
                removeTemporaryFile(temporaryFile.path);
            }

            if (stagingDirectory) {
                fs.rmSync(stagingDirectory, { recursive: true, force: true });
            }
        }
    }
);

// Unity's multipart encoding is rejected by the current hosted proxy even
// though ordinary curl multipart requests pass. This JSON transport carries
// the same bundle data without changing its stored or publicly served format.
app.post("/api/scenes/:sceneId/json", (req, res) => {
    const sceneId = req.params.sceneId;
    let stagingDirectory;

    try {
        if (!isSafeIdentifier(sceneId)) {
            return res.status(400).json({ error: "Invalid scene ID." });
        }

        if (typeof req.body?.sceneJson !== "string") {
            return res.status(400).json({ error: "The sceneJson value is required." });
        }

        let sceneData;

        try {
            sceneData = JSON.parse(req.body.sceneJson);
        } catch {
            return res.status(400).json({ error: "The sceneJson value is not valid JSON." });
        }

        if (sceneData.sceneId !== sceneId) {
            return res.status(400).json({
                error: "The URL scene ID does not match sceneJson."
            });
        }

        const submittedImages = Array.isArray(req.body.images) ? req.body.images : [];

        if (submittedImages.length > 100) {
            return res.status(400).json({ error: "A scene may contain at most 100 images." });
        }

        const uploadedImages = new Map();

        for (const submittedImage of submittedImages) {
            if (!isSafePngFileName(submittedImage?.fileName)) {
                return res.status(400).json({ error: "An image has an invalid filename." });
            }

            if (uploadedImages.has(submittedImage.fileName)) {
                return res.status(400).json({
                    error: `Duplicate image filename: ${submittedImage.fileName}`
                });
            }

            if (typeof submittedImage.sourceUrl === "string") {
                uploadedImages.set(submittedImage.fileName, resolveSceneImageSource(submittedImage.sourceUrl));
                continue;
            }

            if (typeof submittedImage.base64Data !== "string" ||
                !isValidBase64(submittedImage.base64Data)) {
                return res.status(400).json({
                    error: `Invalid image data: ${submittedImage.fileName}`
                });
            }

            const imageBuffer = Buffer.from(submittedImage.base64Data, "base64");

            if (imageBuffer.length > 15 * 1024 * 1024) {
                return res.status(413).json({
                    error: `Image is too large: ${submittedImage.fileName}`
                });
            }

            uploadedImages.set(submittedImage.fileName, imageBuffer);
        }

        const audioFiles = prepareSceneAudio(sceneData, req.body.audio || [], __dirname, UPLOADS_DIRECTORY);

        const sceneObjects = Array.isArray(sceneData.objects) ? sceneData.objects : [];

        for (const sceneObject of sceneObjects) {
            if (sceneObject.type !== "image") {
                continue;
            }

            if (typeof sceneObject.assetUrl !== "string" ||
                !sceneObject.assetUrl.startsWith("images/")) {
                return res.status(400).json({
                    error: `Image ${sceneObject.objectId || "(unknown)"} has an invalid assetUrl.`
                });
            }

            const imageFileName = sceneObject.assetUrl.slice("images/".length);

            if (!isSafePngFileName(imageFileName) || !uploadedImages.has(imageFileName)) {
                return res.status(400).json({
                    error: `Missing uploaded image: ${sceneObject.assetUrl}`
                });
            }
        }

        stagingDirectory = fs.mkdtempSync(
            path.join(TEMP_UPLOAD_DIRECTORY, `scene-${sceneId}-`)
        );
        const stagingImagesDirectory = path.join(stagingDirectory, "images");
        fs.mkdirSync(stagingImagesDirectory, { recursive: true });

        fs.writeFileSync(path.join(stagingDirectory, "scene.json"), req.body.sceneJson);

        for (const [fileName, imageBuffer] of uploadedImages) {
            const destination = path.join(stagingImagesDirectory, fileName);
            if (Buffer.isBuffer(imageBuffer)) fs.writeFileSync(destination, imageBuffer);
            else fs.copyFileSync(imageBuffer, destination);
        }

        copySceneAudio(audioFiles, stagingDirectory);

        const destinationDirectory = path.join(PUBLISHED_SCENES_DIRECTORY, sceneId);
        replaceDirectory(stagingDirectory, destinationDirectory);
        stagingDirectory = undefined;

        const sceneUrl = `${SERVER_URL}/scenes/${sceneId}/scene.json`;
        console.log(`Published scene ${sceneId} through JSON transport.`);

        return res.json({
            success: true,
            sceneId,
            sceneUrl
        });
    } catch (error) {
        console.error("JSON scene publishing failed:", error);
        return res.status(error.status || 500).json({ error: error.status ? error.message : "The scene could not be published." });
    } finally {
        if (stagingDirectory) {
            fs.rmSync(stagingDirectory, { recursive: true, force: true });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    if (CREATE_TEST_SESSION_ON_STARTUP) {
        const testSession = createSession();

        console.warn("\n*** DEVELOPMENT TEST SESSION — REMOVE BEFORE PRODUCTION ***");
        console.warn(`Open this URL to test uploads: ${testSession.sessionURL}`);
        console.warn("****************************************************************\n");
    }
});


//***generate session ID

function generateSessionID(length = 6) {

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id = "";

    for (let i = 0; i < length; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }

    return id;
}

//***generate session

function createSession() {

    const id = generateSessionID();

    const session = {

        sessionId: id,

        sessionURL: `${SERVER_URL}/session/${id}`,

        created: new Date(),

        uploads: []

    };

    sessions[id] = session;

    return session;
}

// Multer calls this before accepting a file. Checking the browser-provided MIME
// type is not a complete security boundary, but it prevents obvious non-image
// uploads from reaching the editor and AI model.
function imageFileFilter(req, file, callback) {

    if (file.mimetype && file.mimetype.startsWith("image/")) {
        return callback(null, true);
    }

    callback(new Error("Only image files are allowed."));
}

// Accept only the two multipart file fields used by scene publishing.
function sceneBundleFileFilter(req, file, callback) {

    if (file.fieldname === "scene" &&
        (file.mimetype === "application/json" || file.originalname === "scene.json")) {
        return callback(null, true);
    }

    if (file.fieldname === "images" &&
        file.mimetype === "image/png" &&
        isSafePngFileName(file.originalname)) {
        return callback(null, true);
    }

    callback(new Error("Scene bundles may contain only scene.json and PNG images."));
}

// IDs are used as directory names, so permit only a small path-safe alphabet.
function isSafeIdentifier(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isSafePngFileName(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]+\.png$/.test(value);
}

function isValidBase64(value) {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

// Replace an existing published version without leaving the scene directory
// missing if moving the newly validated bundle unexpectedly fails.
function replaceDirectory(sourceDirectory, destinationDirectory) {
    const backupDirectory = `${destinationDirectory}.previous`;
    fs.rmSync(backupDirectory, { recursive: true, force: true });

    if (fs.existsSync(destinationDirectory)) {
        fs.renameSync(destinationDirectory, backupDirectory);
    }

    try {
        fs.renameSync(sourceDirectory, destinationDirectory);
        fs.rmSync(backupDirectory, { recursive: true, force: true });
    } catch (error) {
        if (fs.existsSync(backupDirectory) && !fs.existsSync(destinationDirectory)) {
            fs.renameSync(backupDirectory, destinationDirectory);
        }

        throw error;
    }
}

// Convert HEIC/HEIF to PNG before resizing. This uses a dedicated decoder,
// rather than relying on optional native HEIC support in the server's Sharp
// installation. Other image formats go directly to Sharp.
async function resizeImage(input, mimeType = "", originalName = "") {

    // Sharp can read ordinary image files directly from disk, avoiding a large
    // JavaScript Buffer for every camera upload. HEIC needs a Buffer only while
    // the dedicated converter is actively translating it to PNG.
    let source = input;

    if (isHeicImage(mimeType, originalName)) {
        console.log("Converting HEIC/HEIF image to PNG before processing.");
        const heicBuffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
        source = Buffer.from(await convertHeic({
            buffer: heicBuffer,
            format: "PNG"
        }));
    }

    // Resize with "inside" so an 1600 x 800 image becomes 1000 x 500, while a
    // 500 x 500 image remains 500 x 500. rotate() also honours phone-camera
    // EXIF orientation before the pixels are resized and written as PNG.
    return sharp(source)
        .rotate()
        .resize({
            width: MAX_IMAGE_DIMENSION,
            height: MAX_IMAGE_DIMENSION,
            fit: "inside",
            withoutEnlargement: true
        })
        .png()
        .toBuffer();
}

function isHeicImage(mimeType, originalName) {

    if (HEIC_MIME_TYPES.has(mimeType.toLowerCase())) {
        return true;
    }

    return /\.(heic|heif)$/i.test(originalName);
}

// Multer temporary files are safe to remove after a response, because final
// session images are written separately into uploads/<session-id>/*.png.
function removeTemporaryFile(filePath) {

    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

// Resolve existing media on disk only; a save never fetches arbitrary URLs.
function resolveSceneImageSource(sourceUrl) {
    const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
    let pathname;
    try { pathname = decodeURIComponent(new URL(sourceUrl, "http://local").pathname); }
    catch { fail("Invalid image source."); }
    if (!/^\/(uploads\/[A-Za-z0-9_-]{1,64}|scenes\/[A-Za-z0-9_-]{1,64}\/images)\/[A-Za-z0-9_-]+\.png$/i.test(pathname))
        fail("Image must come from a session or a saved scene.");
    const isUpload = pathname.startsWith("/uploads/");
    const root = fs.realpathSync(isUpload ? UPLOADS_DIRECTORY : path.join(__dirname, "public"));
    const filename = path.join(root, isUpload ? pathname.slice("/uploads/".length) : pathname.slice(1));
    if (!fs.existsSync(filename)) fail("An image source is missing. Upload it again.");
    const real = fs.realpathSync(filename);
    if (real !== path.resolve(filename) || !real.startsWith(root + path.sep)) fail("Invalid image source path.");
    const info = fs.statSync(real);
    if (!info.isFile()) fail("Invalid image source file.");
    if (info.size > 15 * 1024 * 1024) fail("An image is too large (maximum 15 MB).", 413);
    const header = Buffer.alloc(8);
    const fd = fs.openSync(real, "r");
    try { fs.readSync(fd, header, 0, 8, 0); } finally { fs.closeSync(fd); }
    if (!header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail("Image source must be a PNG.");
    return real;
}
