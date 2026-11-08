const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('session audio uploads preserve bytes, reject invalid files, and coexist with images', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-audio-'));
    const port = 18249;
    const server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
            server.stdout.on('data', data => { if (data.toString().includes('Server running')) { clearTimeout(timeout); resolve(); } });
            server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
        });
        const base = `http://localhost:${port}`;
        const session = await (await fetch(`${base}/create-session`, { method: 'POST' })).json();
        const endpoint = `${base}/api/session/${session.sessionId}`;
        const send = (url, bytes, name, type, field = 'audio') => {
            const form = new FormData(); form.append(field, new Blob([bytes], { type }), name);
            return fetch(url, { method: 'POST', body: form });
        };
        const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(4,40);
        let response = await send(`${endpoint}/upload`, wav, 'voice.wav', 'audio/wav');
        assert.equal(response.status, 200); const { filename } = await response.json(); assert.match(filename, /\.wav$/);
        assert.deepEqual(fs.readFileSync(path.join(cwd, 'uploads', session.sessionId, filename)), wav);
        assert.equal((await send(`${endpoint}/upload`, 'fake audio', 'bad.mp3', 'audio/mpeg')).status, 422);
        assert.equal((await send(`${endpoint}/upload`, wav, 'bad.exe', 'audio/wav')).status, 400);
        assert.equal((await send(`${endpoint}/upload`, '', 'empty.wav', 'audio/wav')).status, 422);
        assert.equal((await send(`${endpoint}/upload`, Buffer.alloc(15 * 1024 * 1024 + 1), 'large.wav', 'audio/wav')).status, 413);
        assert.equal((await send(`${base}/api/session/unknown/upload`, wav, 'voice.wav', 'audio/wav')).status, 404);
        const png = await require('sharp')({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
        assert.equal((await send(`${endpoint}/upload`, png, 'photo.png', 'image/png', 'image')).status, 200);
        const listing = await (await fetch(`${endpoint}/uploads`)).json();
        assert.equal(listing.media.length, 2); assert.ok(listing.media.includes(filename));
        assert.equal((await fetch(`${base}/api/session/unknown/uploads`)).status, 404);
        assert.equal(fs.readdirSync(path.join(root, 'tmp')).length, 0);
    } finally { server.kill(); fs.rmSync(cwd, { recursive: true, force: true }); }
});
