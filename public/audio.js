(() => {
    const id = location.pathname.replace(/\/$/, '').split('/').pop();
    const endpoint = `/api/session/${encodeURIComponent(id)}`;
    const record = document.getElementById('record-audio');
    const stop = document.getElementById('stop-audio');
    const input = document.getElementById('audio-file');
    const submit = document.getElementById('submit-audio');
    const preview = document.getElementById('audio-preview');
    const status = document.getElementById('audio-status');
    const maxBytes = 15 * 1024 * 1024;
    let file, url, recorder, stream, timer, chunks, bytes, discarded, starting = false;
    const say = text => { status.textContent = text; };
    function releaseMicrophone() {
        clearTimeout(timer);
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
    }
    function selectFile(next) {
        if (!next.size || next.size > maxBytes) {
            say('Choose a non-empty audio file, 15 MB or smaller.');
            return;
        }
        preview.pause();
        if (url) URL.revokeObjectURL(url);
        file = next;
        url = URL.createObjectURL(file);
        preview.src = url;
        preview.hidden = false;
        submit.disabled = false;
        say('Listen to your preview, then upload when ready.');
    }
    input.addEventListener('change', () => {
        if (input.files[0]) selectFile(input.files[0]);
        input.value = '';
    });
    const canRecord = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
    if (!canRecord) {
        record.disabled = true;
        say('Recording needs HTTPS and a browser with microphone recording support. You can still choose an audio file.');
    }
    record.addEventListener('click', async () => {
        starting = true;
        record.disabled = input.disabled = submit.disabled = true;
        preview.pause();
        say('Waiting for microphone permission…');
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!starting) { releaseMicrophone(); return; }
            const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
                .find(type => MediaRecorder.isTypeSupported(type));
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            chunks = []; bytes = 0; discarded = false;
            recorder.ondataavailable = event => {
                bytes += event.data.size;
                if (bytes > maxBytes) {
                    discarded = true; chunks = [];
                    if (recorder.state !== 'inactive') recorder.stop();
                    say('Recording exceeded 15 MB. Please make a shorter recording.');
                } else if (!discarded && event.data.size) chunks.push(event.data);
            };
            recorder.onerror = () => {
                discarded = true;
                say('Recording failed. Try again or choose an audio file.');
                releaseMicrophone();
                record.disabled = input.disabled = false;
                stop.disabled = true;
                submit.disabled = !file;
            };
            recorder.onstop = () => {
                releaseMicrophone();
                record.disabled = input.disabled = false;
                stop.disabled = true;
                submit.disabled = !file;
                if (discarded) return;
                const type = recorder.mimeType || chunks[0]?.type || '';
                const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('webm') ? 'webm' : null;
                if (!ext) { say('This browser records an unsupported format. Please choose an audio file.'); return; }
                selectFile(new File(chunks, `recording.${ext}`, { type }));
                chunks = [];
            };
            recorder.start(1000);
            stop.disabled = false;
            say('Recording… Tap Stop when finished (five-minute maximum).');
            timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 5 * 60 * 1000);
        } catch (error) {
            releaseMicrophone();
            record.disabled = input.disabled = false;
            submit.disabled = !file;
            say(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access or choose an audio file.' : 'Could not start recording. Try again or choose an audio file.');
        } finally { starting = false; }
    });
    stop.addEventListener('click', () => {
        stop.disabled = true;
        if (recorder?.state !== 'inactive') recorder.stop();
    });
    submit.addEventListener('click', async () => {
        if (!file) return;
        record.disabled = input.disabled = submit.disabled = true;
        say('Uploading sound…');
        try {
            const data = new FormData();
            data.append('audio', file, file.name);
            const response = await fetch(`${endpoint}/upload`, { method: 'POST', body: data });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Upload failed. Please try again.');
            say('Sound uploaded to this session.');
            file = null;
            preview.pause(); preview.removeAttribute('src'); preview.hidden = true;
            URL.revokeObjectURL(url); url = null;
            await loadUploads();
        } catch (error) { say(error.message); }
        finally {
            record.disabled = !canRecord;
            input.disabled = false;
            submit.disabled = !file;
        }
    });
    async function loadUploads() {
        const container = document.getElementById('session-uploads');
        try {
            const response = await fetch(`${endpoint}/uploads`);
            if (!response.ok) throw new Error();
            const { media } = await response.json();
            container.replaceChildren();
            for (const name of media) {
                const audio = /\.(webm|ogg|mp3|wav|m4a|mp4|aac|flac)$/i.test(name);
                if (!audio && !/\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
                const item = document.createElement('div');
                const element = document.createElement(audio ? 'audio' : 'img');
                element.src = `/uploads/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
                element.style.maxWidth = '100%';
                if (audio) { element.controls = true; element.preload = 'none'; }
                else { element.alt = 'Session image'; element.loading = 'lazy'; }
                const link = document.createElement('a');
                link.href = element.src; link.textContent = name; link.download = name;
                item.append(element, document.createElement('br'), link);
                container.append(item);
            }
            if (!media.length) container.textContent = 'No uploads yet.';
        } catch { container.textContent = 'Could not load session uploads. Reload to try again.'; }
    }
    // Refresh after image uploads too, without changing their editor workflow.
    window.addEventListener('toolkit-media-uploaded', loadUploads);
    window.addEventListener('pagehide', () => {
        starting = false;
        discarded = true;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        releaseMicrophone();
        if (url) URL.revokeObjectURL(url);
    });
    loadUploads();
})();
