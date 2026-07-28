console.log("Toolkit Server loaded!");

async function loadSessions() {

    const response = await fetch("/api/sessions");

    const sessions = await response.json();

    const container = document.getElementById("sessions");

    container.innerHTML = "";

    for (const session of sessions) {

        container.innerHTML += `
            <p>
                <strong>${session.sessionId}</strong>
                (${session.uploads.length} uploads)
            </p>
        `;
    }
}

loadSessions();

loadSessions();