const sessionId = window.location.pathname
    .replace(/\/$/, "")
    .split("/")
    .pop();

document.getElementById("session-id").textContent = sessionId;

const imageInput = document.getElementById("image");
const editor = document.getElementById("editor");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const cropButton = document.getElementById("crop-button");
const removeBackgroundButton = document.getElementById("remove-background-button");
const resetButton = document.getElementById("reset-button");
const uploadButton = document.getElementById("upload-button");

// originalFile never changes, so Reset edits can always return to it. currentFile
// is the version that will be cropped, background-removed, or finally uploaded.
let originalFile = null;
let currentFile = null;
let previewURL = null;

imageInput.addEventListener("change", () => {

    const file = imageInput.files[0];

    if (!file) {
        return;
    }

    originalFile = file;
    currentFile = file;
    editor.hidden = false;
    showPreview(currentFile);
    setStatus("Image ready to edit.");
});

// A square crop is a simple, useful default for game-toolkit assets. It crops
// from the centre and runs entirely in the browser, without uploading anything.
cropButton.addEventListener("click", async () => {

    setBusy(true, "Cropping image…");

    try {
        currentFile = await cropToSquare(currentFile);
        showPreview(currentFile);
        setStatus("Cropped to a square.");
    } catch (error) {
        console.error(error);
        setStatus("We could not crop this image.");
    } finally {
        setBusy(false);
    }
});

// This is the only editing action that contacts the server. The server runs the
// AI model and sends the transparent PNG back; it does not save it yet.
removeBackgroundButton.addEventListener("click", async () => {

    setBusy(true, "Removing background… This can take a moment.");

    try {
        const formData = new FormData();
        formData.append("image", currentFile, currentFile.name);

        const response = await fetch(`/api/session/${sessionId}/remove-background`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Background removal failed.");
        }

        const png = await response.blob();
        currentFile = new File([png], "image-without-background.png", {
            type: "image/png"
        });
        showPreview(currentFile);
        setStatus("Background removed. Review the preview, then upload when ready.");
    } catch (error) {
        console.error(error);
        setStatus(error.message || "Background removal failed. You can still upload this image.");
    } finally {
        setBusy(false);
    }
});

resetButton.addEventListener("click", () => {

    if (!originalFile) {
        return;
    }

    currentFile = originalFile;
    showPreview(currentFile);
    setStatus("Edits reset to the original image.");
});

// Only this action permanently stores the image in the session upload folder.
uploadButton.addEventListener("click", async () => {

    if (!currentFile) {
        return;
    }

    setBusy(true, "Uploading image…");

    try {
        const formData = new FormData();
        formData.append("image", currentFile, currentFile.name);

        const response = await fetch(`/api/session/${sessionId}/upload`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw new Error("Upload failed.");
        }

        setStatus("Upload successful.");
    } catch (error) {
        console.error(error);
        setStatus("Upload failed. Please try again.");
    } finally {
        setBusy(false);
    }
});

function showPreview(file) {

    // Object URLs avoid converting a potentially large phone photo to base64.
    if (previewURL) {
        URL.revokeObjectURL(previewURL);
    }

    previewURL = URL.createObjectURL(file);
    preview.src = previewURL;
}

async function cropToSquare(file) {

    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - side) / 2);
    const sourceY = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement("canvas");

    canvas.width = side;
    canvas.height = side;

    const context = canvas.getContext("2d");
    context.drawImage(bitmap, sourceX, sourceY, side, side, 0, 0, side, side);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
        throw new Error("The browser could not create the cropped image.");
    }

    return new File([blob], "cropped-image.png", { type: "image/png" });
}

function setBusy(isBusy, message = "") {

    [cropButton, removeBackgroundButton, resetButton, uploadButton].forEach((button) => {
        button.disabled = isBusy;
    });

    if (message) {
        setStatus(message);
    }
}

function setStatus(message) {
    status.textContent = message;
}
