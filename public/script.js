let publishedScenes = [];

async function loadScenes() {
    const container = document.getElementById("scenes");

    try {
        const response = await fetch("/api/scenes");

        if (!response.ok) {
            throw new Error("The scene list could not be loaded.");
        }

        const scenes = await response.json();
        publishedScenes = scenes;
        container.replaceChildren();

        if (scenes.length === 0) {
            const emptyMessage = document.createElement("p");
            emptyMessage.className = "scene-status";
            emptyMessage.textContent = "No scenes have been published yet.";
            container.appendChild(emptyMessage);
            return;
        }

        for (const scene of scenes) {
            container.appendChild(createSceneCard(scene));
        }
    } catch (error) {
        container.replaceChildren();
        const errorMessage = document.createElement("p");
        errorMessage.className = "scene-status scene-error";
        errorMessage.textContent = error.message;
        container.appendChild(errorMessage);
    }
}

document.getElementById("open-scene-form").addEventListener("submit", async event => {
    event.preventDefault();

    const codeInput = document.getElementById("scene-code");
    const message = document.getElementById("open-scene-message");
    const code = codeInput.value.trim();

    message.classList.remove("form-error");
    message.textContent = "";

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) {
        message.classList.add("form-error");
        message.textContent = "Enter a valid scene code.";
        return;
    }

    try {
        // Check the entered code directly. Private scenes are intentionally not
        // exposed by the public /api/scenes listing.
        const response = await fetch(
            `/api/scenes/${encodeURIComponent(code)}/status`,
            { cache: "no-store" }
        );
        if (!response.ok) {
            throw new Error("Scene status unavailable.");
        }

        const sceneStatus = await response.json();
        if (!sceneStatus.exists) {
            message.classList.add("form-error");
            message.textContent = `No scene was found with the code “${code}”.`;
            return;
        }

        window.location.href = `/editor/?scene=${encodeURIComponent(code)}`;
    } catch (error) {
        message.classList.add("form-error");
        message.textContent = "The scene could not be checked. Please try again.";
    }
});

function createSceneCard(scene) {
    const link = document.createElement("a");
    link.className = "scene-card";
    link.href = scene.viewerUrl;

    const preview = document.createElement("div");
    preview.className = "scene-preview";

    if (scene.thumbnailUrls.length === 0) {
        preview.classList.add("scene-preview-empty");
        preview.textContent = "No images";
    } else {
        preview.classList.add(`scene-preview-${scene.thumbnailUrls.length}`);

        for (const imageUrl of scene.thumbnailUrls) {
            const image = document.createElement("img");
            image.src = imageUrl;
            image.alt = "";
            image.loading = "lazy";
            preview.appendChild(image);
        }
    }

    const details = document.createElement("div");
    details.className = "scene-details";

    const title = document.createElement("h2");
    title.textContent = scene.title;

    const imageCount = document.createElement("p");
    imageCount.textContent = `${scene.imageCount} ${scene.imageCount === 1 ? "image" : "images"}`;

    details.append(title, imageCount);
    link.append(preview, details);
    return link;
}

async function loadSessions() {
    const container = document.getElementById("sessions");

    try {
        const response = await fetch("/api/sessions");
        const sessions = await response.json();
        container.replaceChildren();

        if (sessions.length === 0) {
            container.textContent = "No active sessions.";
            return;
        }

        for (const session of sessions) {
            const paragraph = document.createElement("p");
            const link = document.createElement("a");
            link.href = `/session/${encodeURIComponent(session.sessionId)}/`;
            link.textContent = session.sessionId;
            paragraph.append(link, ` (${session.uploads.length} uploads)`);
            container.appendChild(paragraph);
        }
    } catch {
        container.textContent = "Sessions could not be loaded.";
    }
}

loadScenes();
loadSessions();
