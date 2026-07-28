const express = require("express");
const path = require("path");

const app = express();

const PORT = 3000;

// Serve everything inside /public
app.use(express.static(path.join(__dirname, "public")));


const sessions = {};

//**create session

app.post("/create-session", (req, res) => {

    const id = generateSessionID();

    sessions[id] = {

        created: new Date(),

        uploads: []

    };

    //for debugging
    console.log(sessions);

    console.log("Created session:", id);

    res.json({

        sessionId: id

    });

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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


//generate session ID

function generateSessionID(length = 6) {

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let id = "";

    for (let i = 0; i < length; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }

    return id;
}