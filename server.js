const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const multer = require("multer");
const fs = require("fs");
const { removeBackground } = require("@imgly/background-removal-node");

const app = express();

const PORT = 3000;
const SERVER_URL = "http://localhost:3000";

const sessions = {};

app.use(express.json());

// Store final uploads on disk. These are the images that the user has approved
// in the editor, so they belong in the session's permanent upload folder.
const upload = multer({
    dest: "uploads/",
    limits: {
        // A friendly upper limit for mobile camera photos. It also prevents a
        // very large file from exhausting memory during background removal.
        fileSize: 15 * 1024 * 1024
    },
    fileFilter: imageFileFilter
});

// Keep temporary editor images in memory instead of writing them to disk. The
// background-removal endpoint sends its PNG result straight back to the browser.
const editorUpload = multer({
    storage: multer.memoryStorage(),
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
    (req, res) => {

        const sessionId = req.params.id;

        if (!sessions[sessionId]) {
            return res.status(404).send("Session not found.");
        }

        if (!req.file) {
            return res.status(400).send("No file uploaded.");
        }

        // Create the session folder if needed.
        const sessionFolder = path.join("uploads", sessionId);

        fs.mkdirSync(sessionFolder, { recursive: true });

        // Generate the next filename.
        const extension = path.extname(req.file.originalname);

        const files = fs.readdirSync(sessionFolder);

        const filename =
            String(files.length + 1).padStart(6, "0") +
            extension;

        // Move the uploaded file.
        const destination = path.join(sessionFolder, filename);

        fs.renameSync(req.file.path, destination);

        console.log(`Saved ${destination}`);

        res.json({
            success: true,
            filename: filename
        });

    }
);

//** remove an image background for the mobile editor

app.post(
    "/api/session/:id/remove-background",
    editorUpload.single("image"),
    async (req, res) => {

        // Do not process images for a session that does not exist.
        if (!sessions[req.params.id]) {
            return res.status(404).json({ error: "Session not found." });
        }

        if (!req.file) {
            return res.status(400).json({ error: "Please provide an image." });
        }

        try {
            // The package runs its segmentation model on this Node server.
            // It returns a Blob containing a PNG with transparent pixels where
            // the background was removed.
            const output = await removeBackground(req.file.buffer);
            const pngBuffer = Buffer.from(await output.arrayBuffer());

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
