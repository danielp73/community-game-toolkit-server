const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const multer = require("multer");
const fs = require("fs");
const sharp = require("sharp");
const convertHeic = require("heic-convert");
const { removeBackground } = require("@imgly/background-removal-node");

const app = express();

const PORT = 8000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// DEVELOPMENT ONLY — set this to false (or remove this block) before deploying
// to production. It creates a fresh session every time this server starts, so
// local testing does not require a curl command or dashboard interaction.
const CREATE_TEST_SESSION_ON_STARTUP = true;

// Change this one value to set the maximum width or height of every image that
// enters the editor. Images retain their original shape and are never enlarged.
const MAX_IMAGE_DIMENSION = 1000;

// The medium model gave better quality without a meaningful speed penalty in
// testing. Change this to "small" only if a later server benchmark improves.
const BACKGROUND_REMOVAL_MODEL = "medium";

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

const sessions = {};

app.use(express.json());

// Store final uploads on disk. These are the images that the user has approved
// in the editor, so they belong in the session's permanent upload folder.
const upload = multer({
    dest: TEMP_UPLOAD_DIRECTORY,
    limits: {
        // A friendly upper limit for mobile camera photos. It also prevents a
        // very large file from exhausting memory during background removal.
        fileSize: 15 * 1024 * 1024
    },
    fileFilter: imageFileFilter
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


//** dashboard
 
// Serve everything inside /public and /uploads
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));


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
    upload.single("image"),
    async (req, res) => {

        const sessionId = req.params.id;

        if (!sessions[sessionId]) {
            return res.status(404).send("Session not found.");
        }

        if (!req.file) {
            return res.status(400).send("No file uploaded.");
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
            const sessionFolder = path.join("uploads", sessionId);
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

            // The package needs both image bytes and a MIME type to choose the
            // correct decoder. A raw Node Buffer has no MIME type, so wrap it
            // in a typed Blob.
            const input = new Blob([resizedImage], {
                type: "image/png"
            });

            // The package runs its segmentation model on this Node server. It
            // returns a PNG Blob with transparent pixels where the background
            // was removed.
            const removalStartedAt = Date.now();
            const output = await removeBackground(input, {
                model: BACKGROUND_REMOVAL_MODEL
            });

            console.log(
                `[Background removal] IMG.LY removal completed in ` +
                `${Date.now() - removalStartedAt}ms.`
            );

            const outputConversionStartedAt = Date.now();
            const pngBuffer = Buffer.from(await output.arrayBuffer());

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

    const folder = path.join("uploads", sessionId);

    if (!fs.existsSync(folder)) {
        return res.json([]);
    }

    const files = fs.readdirSync(folder);

    res.json({
        media: files
    });

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
