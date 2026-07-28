const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const multer = require("multer");
const fs = require("fs");

const app = express();

const PORT = 3000;
const SERVER_URL = "http://localhost:3000";

const sessions = {};

app.use(express.json());

//set up multer
const upload = multer({
    dest: "uploads/"
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
