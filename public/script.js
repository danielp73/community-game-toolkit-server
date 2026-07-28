console.log("Toolkit Server loaded!");

async function loadSessions() {

    const response = await fetch("/api/sessions");

    const sessions = await response.json();

    const container = document.getElementById("sessions");

    container.innerHTML = "";

    for (const session of sessions) {
    	console.log(session.sessionId);

        container.innerHTML += `
            <p>
                <a href="/session/${session.sessionId}/"><strong>${session.sessionId}</strong></a>
                (${session.uploads.length} uploads)
            </p>
        `;
    }
}

loadSessions();

loadSessions();