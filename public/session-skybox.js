(() => {
    'use strict';
    const input = document.getElementById('skybox-file');
    const preview = document.getElementById('skybox-preview');
    const clear = document.getElementById('clear-skybox');
    const submit = document.getElementById('upload-skybox');
    const status = document.getElementById('skybox-status');
    const id = location.pathname.replace(/\/$/, '').split('/').pop();
    const endpoint = `/api/session/${encodeURIComponent(id)}/skybox`;
    let previewUrl = null, selection = 0, selectedFile = null;
    let croppedWarning = '';
    function skyboxCrop(width, height) {
        const cropHeight = Math.min(height, width / 2);
        const cropWidth = cropHeight * 2;
        const outputHeight = Math.max(1, Math.min(4096, Math.floor(cropHeight)));
        return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2,
            width: cropWidth, height: cropHeight, outputWidth: outputHeight * 2, outputHeight };
    }
    function releasePreview() {
        preview.hidden = true;
        preview.removeAttribute('src');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
    }
    function busy(active) {
        input.disabled = clear.disabled = active;
        submit.disabled = active || !selectedFile;
    }
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const current = ++selection;
        releasePreview();
        croppedWarning = ''; status.style.cssText = '';
        selectedFile = null;
        submit.disabled = true;
        clear.hidden = true;
        if (!/\.(jpe?g|png)$/i.test(file.name) || file.size > 15 * 1024 * 1024) {
            input.value = '';
            status.textContent = 'Choose a JPG or PNG no larger than 15 MB.';
            return;
        }
        previewUrl = URL.createObjectURL(file);
        const image = new Image();
        status.textContent = 'Preparing preview…';
        image.onload = async () => {
            if (current !== selection) return;
            try {
                const width = image.naturalWidth, height = image.naturalHeight;
                if (width < 2 || height < 1) throw new Error('Choose a larger image.');
                const crop = skyboxCrop(width, height);
                const needsCrop = Math.abs(width / height - 2) > 0.001;
                if (needsCrop || width > 8192 || height > 4096) {
                    const canvas = document.createElement('canvas');
                    canvas.width = crop.outputWidth; canvas.height = crop.outputHeight;
                    canvas.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
                    const type = /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg';
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.92));
                    canvas.width = canvas.height = 0;
                    if (current !== selection) return;
                    if (!blob || blob.size > 15 * 1024 * 1024) throw new Error('The prepared image is too large. Choose a smaller image.');
                    selectedFile = new File([blob], type === 'image/png' ? 'skybox.png' : 'skybox.jpg', {type});
                    URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(blob);
                } else selectedFile = file;
                if (needsCrop) {
                    croppedWarning = 'This image was automatically cropped to 2:1. It is not a proper 360° skybox: it may look distorted and seams may be visible.';
                    status.style.cssText = 'padding:12px;border:1px solid #d49a16;border-radius:8px;background:#fff3cd;color:#664d03';
                }
                preview.src = previewUrl; preview.hidden = false; clear.hidden = false; submit.disabled = false;
                status.textContent = croppedWarning || `${file.name} selected. Ready to upload.`;
            } catch (error) {
                if (current !== selection) return;
                selectedFile = null; releasePreview(); input.value = ''; status.textContent = error.message;
            }
        };
        image.onerror = () => {
            if (current !== selection) return;
            releasePreview();
            input.value = '';
            status.textContent = 'This image could not be opened. Choose another JPG or PNG.';
        };
        image.src = previewUrl;
    });
    clear.addEventListener('click', () => {
        ++selection;
        input.value = '';
        selectedFile = null;
        submit.disabled = true;
        releasePreview();
        clear.hidden = true;
        croppedWarning = ''; status.style.cssText = '';
        status.textContent = 'Selection cleared. The scene skybox has not changed.';
    });
    async function uploadSkybox(body) {
        busy(true);
        status.textContent = 'Uploading skybox…';
        try {
            const response = await fetch(endpoint, { method: 'POST', body });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Could not update the skybox. Try again.');
            status.textContent = 'Skybox uploaded. ' + (croppedWarning || 'Return to the editor to see it.');
            selectedFile = null;
            input.value = '';
            clear.hidden = true;
        } catch (error) { status.textContent = error.message; }
        finally { busy(false); }
    }
    submit.addEventListener('click', () => {
        if (!selectedFile) return;
        const data = new FormData();
        data.append('skybox', selectedFile, selectedFile.name);
        uploadSkybox(data);
    });
})();
