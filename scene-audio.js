const fs = require('node:fs');
const path = require('node:path');
const { validateAudio } = require('./audio-uploads');
const safeAudioName = /^[A-Za-z0-9_-]+\.(webm|ogg|mp3|wav|m4a|mp4|aac|flac)$/i;
function prepareSceneAudio(sceneData, sources, root) {
    const fail = message => { const error = new Error(message); error.status = 400; throw error; };
    const sounds = (sceneData.objects || []).filter(item => item?.type === 'audio');
    if (!Array.isArray(sources) || sources.length > 16 || sounds.length > 16) fail('A scene may contain at most 16 sounds.');
    const files = new Map(); let total = 0;
    for (const source of sources) {
        if (!safeAudioName.test(source?.fileName) || files.has(source.fileName)) fail('Invalid or duplicate sound filename.');
        // Accept a path on this server only. Never fetch client-supplied URLs.
        let pathname;
        try { pathname = decodeURIComponent(new URL(source.sourceUrl, 'http://local').pathname); }
        catch { fail('Invalid sound source.'); }
        if (!/^\/(uploads\/[A-Za-z0-9_-]{1,64}|scenes\/[A-Za-z0-9_-]{1,64}\/audio)\/[A-Za-z0-9_-]+\.(webm|ogg|mp3|wav|m4a|mp4|aac|flac)$/i.test(pathname)) fail('Sound must come from a session or a saved scene.');
        const base = fs.realpathSync(pathname.startsWith('/scenes/') ? path.join(root, 'public') : root);
        const filename = path.join(base, pathname.slice(1));
        if (!fs.existsSync(filename)) fail('A sound source is missing. Upload it again.');
        const real = fs.realpathSync(filename);
        if (!real.startsWith(fs.realpathSync(base) + path.sep) || real !== path.resolve(filename)) fail('Invalid sound source path.');
        const size = fs.statSync(real).size;
        total += size;
        if (total > 100 * 1024 * 1024) fail('Scene audio must total 100 MB or less.');
        const ext = path.extname(real).toLowerCase();
        if (path.extname(source.fileName).toLowerCase() !== ext) fail('Sound format must be preserved.');
        try { validateAudio({ path: real, originalname: real, mimetype: 'application/octet-stream', size }); }
        catch (error) { fail(error.message); }
        files.set(source.fileName, real);
    }
    const ids = new Set();
    for (const sound of sounds) {
        if (typeof sound.objectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sound.objectId) || ids.has(sound.objectId)) fail('Invalid or duplicate sound ID.');
        ids.add(sound.objectId);
        if (typeof sound.assetUrl !== 'string' || !sound.assetUrl.startsWith('audio/') || !files.has(sound.assetUrl.slice(6))) fail('A sound is missing from the scene bundle.');
        const a = sound.audio;
        if (!a || typeof a.spatial !== 'boolean' || typeof a.loop !== 'boolean' || typeof a.autoplay !== 'boolean' || !Number.isFinite(a.volume) || a.volume < 0 || a.volume > 1 || !Number.isFinite(a.radius) || a.radius < 0.5 || a.radius > 100) fail('Invalid sound playback settings.');
        if (!sound.transform?.position || !['x','y','z'].every(axis => Number.isFinite(sound.transform.position[axis]))) fail('Invalid sound position.');
    }
    return files;
}
function copySceneAudio(files, staging) {
    if (!files.size) return;
    const folder = path.join(staging, 'audio'); fs.mkdirSync(folder, { recursive: true });
    for (const [name, source] of files) fs.copyFileSync(source, path.join(folder, name));
}
module.exports = { prepareSceneAudio, copySceneAudio };
