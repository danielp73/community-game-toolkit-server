const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const formats = {
    '.webm': ['audio/webm', 'video/webm'],
    '.ogg': ['audio/ogg', 'application/ogg'],
    '.mp3': ['audio/mpeg', 'audio/mp3'],
    '.wav': ['audio/wav', 'audio/x-wav', 'audio/wave'],
    '.m4a': ['audio/mp4', 'audio/x-m4a'],
    '.mp4': ['audio/mp4'],
    '.aac': ['audio/aac'],
    '.flac': ['audio/flac', 'audio/x-flac']
};
function audioExtension(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.split(';')[0].toLowerCase();
    if (!formats[ext] || !(formats[ext].includes(mime) || mime === 'application/octet-stream')) {
        throw new Error('Choose WebM, Ogg, MP3, WAV, M4A, MP4 audio, AAC, or FLAC.');
    }
    return ext;
}
// Check a small container header, never decode or convert the recording.
function validateAudio(file) {
    const ext = audioExtension(file);
    if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error('Audio must be between 1 byte and 15 MB.');
    const header = Buffer.alloc(4096);
    const fd = fs.openSync(file.path, 'r');
    let size;
    try { size = fs.readSync(fd, header, 0, header.length, 0); }
    finally { fs.closeSync(fd); }
    const bytes = header.subarray(0, size);
    const text = (start, end) => bytes.toString('ascii', start, end);
    const valid = {
        '.webm': () => bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && bytes.includes(Buffer.from('webm')),
        '.ogg': () => text(0, 4) === 'OggS' && (bytes.includes(Buffer.from('OpusHead')) || bytes.includes(Buffer.from('vorbis')) || bytes.includes(Buffer.from('FLAC'))),
        '.mp3': () => text(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
        '.wav': () => text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE',
        '.m4a': () => text(4, 8) === 'ftyp',
        '.mp4': () => text(4, 8) === 'ftyp',
        '.aac': () => bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0,
        '.flac': () => text(0, 4) === 'fLaC'
    }[ext]();
    if (!valid) throw new Error('This file does not match its audio format. Choose another recording.');
    return ext;
}
function saveAudio(file, sessionId, uploadsDirectory = path.resolve('uploads')) {
    const ext = validateAudio(file);
    const folder = path.join(uploadsDirectory, sessionId);
    fs.mkdirSync(folder, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    fs.renameSync(file.path, path.join(folder, filename));
    return filename;
}
module.exports = { MAX_AUDIO_BYTES, audioExtension, validateAudio, saveAudio };
