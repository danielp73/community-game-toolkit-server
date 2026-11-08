const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup({ secure = true, denied = false } = {}) {
    const elements = new Map(); let tracksStopped = 0, sent;
    function element(id) {
        if (!elements.has(id)) elements.set(id, { disabled: false, hidden: false, files: [], style: {}, handlers: {},
            addEventListener(event, handler) { this.handlers[event] = handler; }, pause() {}, removeAttribute(name) { delete this[name]; }, replaceChildren() {}, append() {} });
        return elements.get(id);
    }
    class Recorder {
        static isTypeSupported(type) { return type === 'audio/mp4'; }
        constructor() { this.mimeType = 'audio/mp4'; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['recording'], { type: this.mimeType }) }); this.onstop(); }
    }
    const context = {
        location: { pathname: '/session/ABC123/' },
        document: { getElementById: element, createElement: () => element(Symbol()) },
        navigator: { mediaDevices: { getUserMedia: async () => {
            if (denied) throw Object.assign(new Error(), { name: 'NotAllowedError' });
            return { getTracks: () => [{ stop() { tracksStopped++; } }] };
        } } },
        MediaRecorder: Recorder, File, Blob, FormData,
        URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
        setTimeout: () => 1, clearTimeout() {},
        fetch: async (url, options) => {
            if (options) { sent = { url, options }; return { ok: true, json: async () => ({ filename: 'audio.m4a' }) }; }
            return { ok: true, json: async () => ({ media: ['audio.m4a', 'image.png'] }) };
        }
    };
    context.window = { isSecureContext: secure, MediaRecorder: Recorder, addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/audio.js'), 'utf8'), context);
    return { element, stopped: () => tracksStopped, sent: () => sent };
}
test('record, stop, preview and submit preserve the recorder format and session', async () => {
    const ui = setup();
    await ui.element('record-audio').handlers.click();
    assert.equal(ui.element('stop-audio').disabled, false);
    assert.equal(ui.element('audio-file').disabled, true);
    ui.element('stop-audio').handlers.click();
    assert.equal(ui.stopped(), 1);
    assert.equal(ui.element('audio-preview').hidden, false);
    assert.equal(ui.element('submit-audio').disabled, false);
    await ui.element('submit-audio').handlers.click();
    assert.equal(ui.sent().url, '/api/session/ABC123/upload');
    assert.equal(ui.sent().options.body.get('audio').name, 'recording.m4a');
    assert.equal(ui.element('submit-audio').disabled, true);
});
test('permission denial restores file selection', async () => {
    const ui = setup({ denied: true }); await ui.element('record-audio').handlers.click();
    assert.match(ui.element('audio-status').textContent, /denied/);
    assert.equal(ui.element('audio-file').disabled, false);
});
test('insecure browser can select and preview an existing file', async () => {
    const ui = setup({ secure: false }); assert.equal(ui.element('record-audio').disabled, true);
    ui.element('audio-file').files = [new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })];
    ui.element('audio-file').handlers.change();
    assert.equal(ui.element('audio-preview').hidden, false);
    await ui.element('submit-audio').handlers.click();
    assert.equal(ui.sent().options.body.get('audio').name, 'song.mp3');
    assert.equal(ui.element('record-audio').disabled, true);
});
