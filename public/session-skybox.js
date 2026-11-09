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
        image.onload = () => {
            if (current !== selection) return;
            preview.src = previewUrl;
            preview.hidden = false;
            clear.hidden = false;
            const width = image.naturalWidth, height = image.naturalHeight;
            if (width > 8192 || height > 4096 || Math.abs(width / height - 2) > 0.1) {
                status.textContent = 'Choose a full spherical image twice as wide as it is tall, at most 8192 × 4096 pixels.';
                return;
            }
            selectedFile = file;
            submit.disabled = false;
            status.textContent = `${file.name} selected (${width} × ${height}). Ready to upload.`;
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
        status.textContent = 'Selection cleared. The scene skybox has not changed.';
    });
    async function uploadSkybox(body) {
        busy(true);
        status.textContent = 'Uploading skybox…';
        try {
            const response = await fetch(endpoint, { method: 'POST', body });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Could not update the skybox. Try again.');
            status.textContent = 'Skybox uploaded. Save your scene in the editor to keep it.';
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
