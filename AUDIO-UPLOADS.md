# Audio uploads (PhotoRoom server)

Run the existing `npm run start:photoroom` entry point. Deploy `server-photoroom.js`, `audio-uploads.js`, and the changed `public/session.html`, `public/session.js`, and `public/audio.js` together. The IMG.LY `server.js` entry point is unchanged.

Audio uses the existing `/api/session/:id/upload` endpoint, with multipart field `audio` instead of `image`. One file is allowed per request, maximum 15 MiB. Files are staged on disk, checked against an extension/MIME allowlist and container header, then moved unchanged into `uploads/<session-id>`. No decoding or conversion is performed. Container header checks are basic format validation, not full media decoding or verification that a container has no video track. Supported formats: WebM, Ogg (Opus/Vorbis/FLAC), MP3, WAV, M4A/MP4 audio, AAC, FLAC. Native playback depends on the browser; download links are also provided.

Browser recordings stop after five minutes and are discarded if they exceed 15 MiB. Microphone recording needs HTTPS (localhost also works) and permission. Unsupported browsers can still select files. The phone session page lists images and audio from the unchanged `{ media: [filename] }` API. Unity audio import/placement is outside this change.

Tests: `node --test tests/*audio*.test.js`.

Manual mobile check before deployment: open a session QR link over HTTPS in iOS Safari and Android Chrome; allow the microphone; Record, Stop, play the preview, and Upload sound; confirm playback in Session uploads. Repeat with a selected audio file, denied microphone permission, and an oversized file. Check image uploads too. These physical-device checks have not been run here.
