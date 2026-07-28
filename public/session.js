const parts = window.location.pathname.split("/");

const sessionID = parts[2];

document.getElementById("session").textContent =
    "Session: " + sessionID;

console.log(sessionID);