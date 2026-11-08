const sessionId = window.location.pathname
    .replace(/\/$/, "")
    .split("/")
    .pop();

document.getElementById("session-id").textContent = sessionId;

const imageInput = document.getElementById("image");
const editor = document.getElementById("editor");
const previewShell = document.getElementById("preview-shell");
const preview = document.getElementById("preview");
const cropCanvas = document.getElementById("crop-canvas");
const removalLoading = document.getElementById("removal-loading");
const status = document.getElementById("status");
const cropButton = document.getElementById("crop-button");
const cropActions = document.getElementById("crop-actions");
const applyCropButton = document.getElementById("apply-crop-button");
const cancelCropButton = document.getElementById("cancel-crop-button");
const removeBackgroundButton = document.getElementById("remove-background-button");
const resetButton = document.getElementById("reset-button");
const uploadButton = document.getElementById("upload-button");

// This is intentionally larger than MAX_IMAGE_DIMENSION in server.js. A 2000px
// preview preserves detail while the user chooses a crop; the server reduces
// the finished image to 1000px before AI processing and permanent storage.
const MAX_PREVIEW_DIMENSION = 2000;

// A separate, smaller working copy is sent to the AI server. This preserves the
// larger preview for cropping, while greatly reducing upload time and server
// memory use when the user removes a background.
const MAX_BACKGROUND_REMOVAL_DIMENSION = 1000;
// The visible handles are 12px circles; their larger hit area makes them easier
// to grab accurately with a thumb on a phone.
const CROP_HANDLE_RADIUS = 24;
const MIN_CROP_FRAME_SIZE = 72;

// originalFile never changes, so Reset edits can always return to it. currentFile
// is the version that will be cropped, background-removed, or finally uploaded.
let originalFile = null;
let currentFile = null;
let previewURL = null;
let cropState = null;
const cropPointers = new Map();
let cropGesture = null;

imageInput.addEventListener("change", async () => {

    const file = imageInput.files[0];

    if (!file) {
        return;
    }

    setBusy(true, "Preparing image…");

    try {
        // Convert the selected file to a max-2000px PNG before showing it. This
        // is especially useful for large iPhone photos, including HEIC files
        // that the phone's browser can decode and draw to the canvas.
        originalFile = await resizeForEditor(file);
        currentFile = originalFile;

        // The editor now owns the smaller PNG. Clear the file picker so the
        // browser can release its reference to the large camera original.
        imageInput.value = "";
        editor.hidden = false;
        showPreview(currentFile);
        setStatus("Image resized and ready to edit.");
    } catch (error) {
        // Leave the original file available if a browser cannot decode it. The
        // server will still make its own resize attempt after upload.
        console.error(error);
        originalFile = file;
        currentFile = file;
        editor.hidden = false;
        showPreview(currentFile);
        setStatus("Preview is ready. This browser could not resize it locally.");
    } finally {
        setBusy(false);
    }
});

// Crop mode is entirely local to the phone. The editable image stays at the
// 2000px preview size until the user applies their freeform crop.
cropButton.addEventListener("click", startCropEditor);
applyCropButton.addEventListener("click", applyCrop);
cancelCropButton.addEventListener("click", cancelCrop);

cropCanvas.addEventListener("pointerdown", onCropPointerDown);
cropCanvas.addEventListener("pointermove", onCropPointerMove);
cropCanvas.addEventListener("pointerup", onCropPointerEnd);
cropCanvas.addEventListener("pointercancel", onCropPointerEnd);

// This is the only editing action that contacts the server. The server runs the
// AI model and sends the transparent PNG back; it does not save it yet.
removeBackgroundButton.addEventListener("click", async () => {

    setBusy(true, "Preparing image for background removal…");
    setRemovalLoading(true);

    try {
        // Keep currentFile unchanged so the 2000px crop remains available in
        // the editor. Only this temporary 1000px copy is sent to the server.
        const removalFile = await resizeForBackgroundRemoval(currentFile);

        setStatus("Removing background… This can take a moment.");
        const formData = new FormData();
        formData.append("image", removalFile, removalFile.name);

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
        setRemovalLoading(false);
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

        const result = await response.json();
        window.dispatchEvent(new Event("toolkit-media-uploaded"));
        setStatus("Upload successful. Returning to your scene…");

        // A WebGL editor opens this page in a dedicated tab. Tell that opener
        // exactly which processed PNG was saved, then close this tab. When the
        // page was opened directly (for example from a QR code), it simply
        // remains open and continues to show the success message.
        if (window.opener && result.filename) {
            window.opener.postMessage({
                type: "toolkit-upload-complete",
                sessionId,
                filename: result.filename
            }, window.location.origin);

            setTimeout(() => window.close(), 500);
        }
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

async function startCropEditor() {

    if (!currentFile) {
        return;
    }

    setBusy(true, "Opening crop editor…");

    try {
        const bitmap = await createImageBitmap(currentFile);
        const shellBounds = previewShell.getBoundingClientRect();
        const width = Math.max(280, Math.round(shellBounds.width));
        const height = Math.min(
            Math.round(window.innerHeight * 0.58),
            Math.max(300, Math.round(width * 0.82))
        );
        const pixelRatio = window.devicePixelRatio || 1;

        // State coordinates use CSS pixels, while the canvas uses device pixels
        // for a sharp crop frame on high-density phone screens.
        cropCanvas.width = Math.round(width * pixelRatio);
        cropCanvas.height = Math.round(height * pixelRatio);
        cropCanvas.style.height = `${height}px`;

        const initialScale = Math.min(width / bitmap.width, height / bitmap.height);
        const frame = {
            x: width * 0.1,
            y: height * 0.1,
            width: width * 0.8,
            height: height * 0.8
        };

        cropState = {
            bitmap,
            width,
            height,
            pixelRatio,
            scale: initialScale,
            offsetX: (width - bitmap.width * initialScale) / 2,
            offsetY: (height - bitmap.height * initialScale) / 2,
            frame
        };

        constrainCropImage();
        setCropMode(true);
        renderCropCanvas();
        setStatus("Drag the photo to reposition it. Pinch to zoom. Drag a corner to resize the crop.");
    } catch (error) {
        console.error(error);
        setStatus("We could not open this image in the crop editor.");
    } finally {
        setBusy(false);
    }
}

async function applyCrop() {

    if (!cropState) {
        return;
    }

    setCropActionBusy(true);

    try {
        currentFile = await createCroppedFile();
        showPreview(currentFile);
        closeCropEditor();
        setStatus("Crop applied. You can continue editing or upload it.");
    } catch (error) {
        console.error(error);
        setStatus("We could not apply this crop.");
    } finally {
        setCropActionBusy(false);
    }
}

function cancelCrop() {

    closeCropEditor();
    setStatus("Crop cancelled.");
}

function setCropMode(isCropping) {

    editor.classList.toggle("is-cropping", isCropping);
    preview.hidden = isCropping;
    cropCanvas.hidden = !isCropping;
    cropActions.hidden = !isCropping;
}

function closeCropEditor() {

    if (cropState?.bitmap) {
        cropState.bitmap.close();
    }

    cropState = null;
    cropPointers.clear();
    cropGesture = null;
    setCropMode(false);
}

function onCropPointerDown(event) {

    if (!cropState) {
        return;
    }

    event.preventDefault();
    cropCanvas.setPointerCapture(event.pointerId);
    cropPointers.set(event.pointerId, cropCanvasPoint(event));

    if (cropPointers.size === 1) {
        const point = cropCanvasPoint(event);
        cropGesture = {
            type: cropHandleAt(point) || "pan",
            startPoint: point,
            startFrame: { ...cropState.frame },
            startOffsetX: cropState.offsetX,
            startOffsetY: cropState.offsetY
        };
    } else if (cropPointers.size === 2) {
        beginPinchGesture();
    }
}

function onCropPointerMove(event) {

    if (!cropState || !cropPointers.has(event.pointerId)) {
        return;
    }

    event.preventDefault();
    cropPointers.set(event.pointerId, cropCanvasPoint(event));

    if (cropPointers.size >= 2) {
        if (cropGesture?.type !== "pinch") {
            beginPinchGesture();
        }
        updatePinchGesture();
    } else if (cropGesture?.type === "pan") {
        const point = cropCanvasPoint(event);
        cropState.offsetX = cropGesture.startOffsetX + point.x - cropGesture.startPoint.x;
        cropState.offsetY = cropGesture.startOffsetY + point.y - cropGesture.startPoint.y;
        constrainCropImage();
    } else if (cropGesture) {
        resizeCropFrame(cropGesture.type, cropCanvasPoint(event));
        constrainCropImage();
    }

    renderCropCanvas();
}

function onCropPointerEnd(event) {

    if (!cropPointers.has(event.pointerId)) {
        return;
    }

    cropPointers.delete(event.pointerId);

    if (cropPointers.size === 1) {
        const point = [...cropPointers.values()][0];
        cropGesture = {
            type: "pan",
            startPoint: point,
            startOffsetX: cropState.offsetX,
            startOffsetY: cropState.offsetY
        };
    } else {
        cropGesture = null;
    }
}

function beginPinchGesture() {

    const [first, second] = [...cropPointers.values()];
    const midpoint = midpointOf(first, second);

    cropGesture = {
        type: "pinch",
        startDistance: distanceBetween(first, second),
        startScale: cropState.scale,
        sourceX: (midpoint.x - cropState.offsetX) / cropState.scale,
        sourceY: (midpoint.y - cropState.offsetY) / cropState.scale
    };
}

function updatePinchGesture() {

    const [first, second] = [...cropPointers.values()];
    const midpoint = midpointOf(first, second);
    const distance = Math.max(1, distanceBetween(first, second));
    const nextScale = cropGesture.startScale * (distance / cropGesture.startDistance);

    cropState.scale = nextScale;
    cropState.offsetX = midpoint.x - cropGesture.sourceX * nextScale;
    cropState.offsetY = midpoint.y - cropGesture.sourceY * nextScale;
    constrainCropImage();
}

function resizeCropFrame(handle, point) {

    const frame = cropGesture.startFrame;
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    const x = Math.max(0, Math.min(cropState.width, point.x));
    const y = Math.max(0, Math.min(cropState.height, point.y));

    if (handle.includes("w")) {
        cropState.frame.x = Math.min(x, right - MIN_CROP_FRAME_SIZE);
        cropState.frame.width = right - cropState.frame.x;
    }
    if (handle.includes("e")) {
        cropState.frame.x = frame.x;
        cropState.frame.width = Math.max(MIN_CROP_FRAME_SIZE, x - frame.x);
    }
    if (handle.includes("n")) {
        cropState.frame.y = Math.min(y, bottom - MIN_CROP_FRAME_SIZE);
        cropState.frame.height = bottom - cropState.frame.y;
    }
    if (handle.includes("s")) {
        cropState.frame.y = frame.y;
        cropState.frame.height = Math.max(MIN_CROP_FRAME_SIZE, y - frame.y);
    }

    // Keep a resized frame inside the visible crop canvas.
    cropState.frame.width = Math.min(cropState.frame.width, cropState.width - cropState.frame.x);
    cropState.frame.height = Math.min(cropState.frame.height, cropState.height - cropState.frame.y);
}

function constrainCropImage() {

    const { bitmap, frame } = cropState;
    const minimumScale = Math.max(frame.width / bitmap.width, frame.height / bitmap.height);
    cropState.scale = Math.max(cropState.scale, minimumScale);

    const imageWidth = bitmap.width * cropState.scale;
    const imageHeight = bitmap.height * cropState.scale;

    cropState.offsetX = Math.min(
        frame.x,
        Math.max(frame.x + frame.width - imageWidth, cropState.offsetX)
    );
    cropState.offsetY = Math.min(
        frame.y,
        Math.max(frame.y + frame.height - imageHeight, cropState.offsetY)
    );
}

function renderCropCanvas() {

    if (!cropState) {
        return;
    }

    const context = cropCanvas.getContext("2d");
    const { bitmap, width, height, pixelRatio, scale, offsetX, offsetY, frame } = cropState;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, offsetX, offsetY, bitmap.width * scale, bitmap.height * scale);

    // Shade every part of the image outside the selected crop rectangle.
    context.fillStyle = "rgba(15, 23, 42, 0.62)";
    context.fillRect(0, 0, width, frame.y);
    context.fillRect(0, frame.y, frame.x, frame.height);
    context.fillRect(frame.x + frame.width, frame.y, width - frame.x - frame.width, frame.height);
    context.fillRect(0, frame.y + frame.height, width, height - frame.y - frame.height);

    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.strokeRect(frame.x, frame.y, frame.width, frame.height);

    context.fillStyle = "#ffffff";
    for (const point of cropHandlePoints()) {
        context.beginPath();
        context.arc(point.x, point.y, 12, 0, Math.PI * 2);
        context.fill();
    }
}

function cropHandlePoints() {

    const { x, y, width, height } = cropState.frame;
    return [
        { name: "nw", x, y },
        { name: "ne", x: x + width, y },
        { name: "sw", x, y: y + height },
        { name: "se", x: x + width, y: y + height }
    ];
}

function cropHandleAt(point) {

    return cropHandlePoints().find((handle) =>
        distanceBetween(point, handle) <= CROP_HANDLE_RADIUS
    )?.name;
}

function cropCanvasPoint(event) {

    const bounds = cropCanvas.getBoundingClientRect();
    return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
    };
}

function midpointOf(first, second) {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distanceBetween(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

async function createCroppedFile() {

    const { bitmap, frame, scale, offsetX, offsetY } = cropState;
    const sourceX = (frame.x - offsetX) / scale;
    const sourceY = (frame.y - offsetY) / scale;
    const sourceWidth = frame.width / scale;
    const sourceHeight = frame.height / scale;
    const outputScale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));

    const context = canvas.getContext("2d");
    context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
    );

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
        throw new Error("The browser could not create the cropped image.");
    }

    return new File([blob], "cropped-image.png", { type: "image/png" });
}

async function resizeForEditor(file) {

    return resizeImage(file, MAX_PREVIEW_DIMENSION, "editor-image.png");
}

async function resizeForBackgroundRemoval(file) {

    return resizeImage(
        file,
        MAX_BACKGROUND_REMOVAL_DIMENSION,
        "background-removal-image.png"
    );
}

// Create a PNG from an image file that fits inside the requested square, without
// enlarging smaller images or changing their aspect ratio.
async function resizeImage(file, maxDimension, outputFilename) {

    const bitmap = await createImageBitmap(file);
    const largestSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxDimension / largestSide);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
        throw new Error("The browser could not resize this image.");
    }

    return new File([blob], outputFilename, { type: "image/png" });
}

function setBusy(isBusy, message = "") {

    [cropButton, removeBackgroundButton, resetButton, uploadButton].forEach((button) => {
        button.disabled = isBusy;
    });

    if (message) {
        setStatus(message);
    }
}

function setCropActionBusy(isBusy) {

    applyCropButton.disabled = isBusy;
    cancelCropButton.disabled = isBusy;
}

function setRemovalLoading(isLoading) {

    // Keep the visual state on the preview and the screen-reader state in sync.
    removalLoading.hidden = !isLoading;
    previewShell.classList.toggle("is-removing-background", isLoading);
    previewShell.setAttribute("aria-busy", String(isLoading));
}

function setStatus(message) {
    status.textContent = message;
}
