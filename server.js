const express = require("express");
const path = require("path");
const QRCode = require("qrcode");

const app = express();

const PORT = 3000;
const SERVER_URL = "http://localhost:3000";

const sessions = {};

app.use(express.json());

//** dashboard
 
// Serve everything inside /public
app.use(express.static(path.join(__dirname, "public")));


//**create session

app.post("/create-session", (req, res) => {

    const session = createSession();

    console.log("Created session:", session.sessionId);

    res.json(session);

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

//**get list of sessions

app.get("/api/sessions", (req, res) => {
    res.json(Object.values(sessions));
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
