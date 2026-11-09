# Scene skyboxes

On the session page, create a spherical photo using the Stanford camera link, save it, choose the JPG/PNG and click **Upload skybox**. The linked, open web editor polls the session and applies it after entering the scene. Upload another to replace it; **Remove scene skybox** restores the original background. Save the scene (existing scenes autosave) to retain the change. Clear selection only clears the local picker.

Accepted images: single-frame JPG/PNG, approximately 2:1, up to 15 MiB and 8192 × 4096 pixels. Server validation decodes the image but does not crop, resize, stitch or re-encode it. Files use a separate `/uploads/_skyboxes/<session>/` folder, so ordinary media import never creates image planes for them.

Session endpoints: GET/POST/DELETE `/api/session/:id/skybox`. Successful changes return a revision token; the web editor applies each token once. Scene JSON uses one object with `type: "skybox"`, `objectId: "skybox"`, and `assetUrl: "skybox/skybox.jpg"` (or `.png`). JSON saves include `skybox: [{fileName, sourceUrl}]`. Only validated existing local session/scene files may be copied. Atomic scene replacement includes the skybox; resaves follow the committed source. Multipart legacy publishing rejects skybox objects to avoid dropping their assets.

Deploy server.js, scene-skybox.js, public/session.html and public/session-skybox.js together, plus rebuilt EditorWebGL and WebGL. Rebuild uses ToolkitSceneSkybox.cs, ToolkitPanoramicSkybox.shader, ToolkitSceneLoader.cs, ToolkitWebEditor.cs, ToolkitViewerBridge.jslib and the editor HTML template. No new dependencies.

Run `node --test tests/*.test.js` in toolkit-server. The skybox integration test covers JPG/PNG byte preservation, upload classification, publication, reopening, resaving, replacement, invalid source paths, missing/corrupt/non-spherical images, removal and temporary file cleanup.
