const sessionId = window.location.pathname
    .replace(/\/$/, "")
    .split("/")
    .pop();

document.getElementById("session-id").textContent = sessionId;

const form = document.getElementById("upload-form");

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const file = document.getElementById("image").files[0];

    if (!file) {
        alert("Please choose an image.");
        return;
    }

    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(`/api/session/${sessionId}/upload`, {
        method: "POST",
        body: formData
    });

    if (response.ok) {
        document.getElementById("status").textContent =
            "Upload successful.";
    }
    else {
        document.getElementById("status").textContent =
            "Upload failed.";
    }

});