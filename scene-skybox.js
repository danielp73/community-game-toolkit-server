const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const multer = require('multer');
const MAX_BYTES = 15 * 1024 * 1024;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
async function validateSkybox(filename) {
    if (fs.statSync(filename).size > MAX_BYTES) fail('Skyboxes must be 15 MB or smaller.', 413);
    let info;
    try {
        info = await sharp(filename, { limitInputPixels: 8192 * 4096 }).metadata();
        if (!['jpeg', 'png'].includes(info.format)) fail('Choose a JPG or PNG skybox.');
        if (info.width > 8192 || info.height > 4096 || info.width < 2 || info.height < 1 || info.pages > 1)
            fail('Skyboxes must be a single image, at most 8192 × 4096 pixels.');
        if (Math.abs(info.width / info.height - 2) > 0.1) fail('Choose a full spherical image approximately twice as wide as it is tall.');
        // Decode without transforming or re-encoding the stored image.
        await sharp(filename, { limitInputPixels: 8192 * 4096 }).stats();
    } catch (error) {
        if (error.status) throw error;
        fail('This skybox image could not be read. Choose a valid JPG or PNG.');
    }
    return info.format === 'jpeg' ? '.jpg' : '.png';
}
function registerSkyboxRoutes(app, sessions, uploads, temp) {
    const upload = multer({ dest: temp, limits: { fileSize: MAX_BYTES, files: 1, fields: 0 } }).single('skybox');
    const findSession = (req, res, next) => sessions[req.params.id] ? next() : res.status(404).json({ error: 'Session not found.' });
    app.get('/api/session/:id/skybox', findSession, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(sessions[req.params.id].skybox || null);
    });
    app.post('/api/session/:id/skybox', findSession, (req, res) => upload(req, res, async error => {
        try {
            if (error) fail(error.code === 'LIMIT_FILE_SIZE' ? 'Skyboxes must be 15 MB or smaller.' : 'Choose one JPG or PNG skybox.', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
            if (!req.file) fail('Choose a skybox image.');
            const extension = await validateSkybox(req.file.path);
            const filename = 'skybox-' + crypto.randomUUID() + extension;
            const folder = path.join(uploads, '_skyboxes', req.params.id);
            fs.mkdirSync(folder, { recursive: true });
            fs.copyFileSync(req.file.path, path.join(folder, filename));
            const skybox = { filename, sourceUrl: `/uploads/_skyboxes/${req.params.id}/${filename}`, revision: crypto.randomUUID() };
            sessions[req.params.id].skybox = skybox;
            res.json(skybox);
        } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'The skybox could not be uploaded.' }); }
        finally { if (req.file?.path) fs.rmSync(req.file.path, { force: true }); }
    }));
    app.delete('/api/session/:id/skybox', findSession, (req, res) => {
        const skybox = { sourceUrl: '', revision: crypto.randomUUID() };
        sessions[req.params.id].skybox = skybox;
        res.json(skybox);
    });
}
async function prepareSceneSkybox(scene, sources, root, uploads) {
    if (scene.skyboxColor != null && !/^#[0-9a-fA-F]{6}$/.test(scene.skyboxColor)) fail('Invalid skybox color.');
    const objects = (scene.objects || []).filter(item => item?.type === 'skybox');
    if (objects.length > 1 || !Array.isArray(sources) || sources.length !== objects.length) fail('A scene may contain one skybox with one matching image.');
    if (!objects.length) return null;
    const object = objects[0], source = sources[0];
    if (!/^skybox\.(jpg|png)$/.test(source?.fileName) || object.assetUrl !== 'skybox/' + source.fileName) fail('Invalid skybox filename.');
    let pathname;
    try { pathname = decodeURIComponent(new URL(source.sourceUrl, 'http://local').pathname); }
    catch { fail('Invalid skybox source.'); }
    if (!/^\/(uploads\/_skyboxes\/[A-Za-z0-9_-]{1,64}\/skybox-[A-Za-z0-9-]+\.(jpg|png)|scenes\/[A-Za-z0-9_-]{1,64}\/skybox\/skybox\.(jpg|png))$/.test(pathname)) fail('Skybox must come from a session or a saved scene.');
    const isUpload = pathname.startsWith('/uploads/');
    const base = fs.realpathSync(isUpload ? uploads : path.join(root, 'public'));
    const filename = path.join(base, isUpload ? pathname.slice(9) : pathname.slice(1));
    if (!fs.existsSync(filename)) fail('The skybox image is missing. Upload it again.');
    const real = fs.realpathSync(filename);
    if (real !== path.resolve(filename) || !real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) fail('Invalid skybox source path.');
    const extension = await validateSkybox(real);
    if (path.extname(source.fileName) !== extension) fail('Skybox format must be preserved.');
    return { fileName: source.fileName, source: real };
}
function copySceneSkybox(file, staging) {
    if (!file) return;
    fs.mkdirSync(path.join(staging, 'skybox'), { recursive: true });
    fs.copyFileSync(file.source, path.join(staging, 'skybox', file.fileName));
}
module.exports = { registerSkyboxRoutes, prepareSceneSkybox, copySceneSkybox };
