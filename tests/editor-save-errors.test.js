const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('save errors show the actual reason once and clear after a successful retry', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/editor/index.html'), 'utf8');
  const start = html.indexOf('window.toolkitEditorSavePayload =');
  const end = html.indexOf('window.toolkitEditorSceneChanged =', start);
  const notices = [];
  const context = {
    window: {}, sceneSaveErrorNotice: null, sceneSaveInProgress: false, savedSceneCode: 'ABCD', autosavePending: false,
    saveSceneButton: { textContent: 'Saved as: ABCD' }, canvas: { focus() {} },
    unityInstance: { SendMessage() {} }, console: { error() {} }, fail: true,
    showBanner(text, type) { const notice = { text, type, remove() { this.removed = true; } }; notices.push(notice); return notice; },
    scheduleAutosave() {}
  };
  context.fetch = async () => ({ ok: !context.fail, json: async () => ({ error: 'A sound source is missing. Upload it again.' }) });
  vm.runInNewContext(html.slice(start, end), context);
  const payload = JSON.stringify({ sceneId: 'ABCD', sceneJson: '{}', images: [], audio: [] });
  for (let i = 0; i < 3; i++) await context.window.toolkitEditorSavePayload(payload);
  assert.equal(notices.filter(item => !item.removed).length, 1);
  assert.equal(notices.at(-1).text, 'A sound source is missing. Upload it again.');
  context.fail = false;
  await context.window.toolkitEditorSavePayload(payload);
  assert.equal(notices.filter(item => !item.removed).length, 0);
  assert.equal(context.sceneSaveErrorNotice, null);
});

test('browser sends small image references and follows committed names on later saves', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/editor/index.html'), 'utf8');
  const start = html.indexOf('window.toolkitEditorSavePayload =');
  const end = html.indexOf('window.toolkitEditorSceneChanged =', start);
  const requests = [];
  const context = { window: {}, sceneSaveErrorNotice: null, sceneSaveInProgress: false, savedSceneCode: 'ABCD', autosavePending: false,
    saveSceneButton: {}, canvas: { focus() {} }, unityInstance: { SendMessage() {} }, console,
    showBanner() {}, scheduleAutosave() {},
    fetch: async (url, options) => { requests.push({url,body:JSON.parse(options.body)}); return {ok:true,json:async()=>({})}; }
  };
  vm.runInNewContext(html.slice(start, end), context);
  const payload = JSON.stringify({sceneId:'ABCD',sceneJson:'{}',images:[{fileName:'image-001.png',sourceUrl:'https://host/scenes/ABCD/images/old-name.png'}]});
  await context.window.toolkitEditorSavePayload(payload);
  assert.equal(requests.length,1);
  assert.equal(requests[0].body.images[0].sourceUrl,'https://host/scenes/ABCD/images/old-name.png');
  assert.equal('base64Data' in requests[0].body.images[0],false);
  await context.window.toolkitEditorSavePayload(payload);
  assert.equal(requests.length,2);
  assert.equal(requests[1].body.images[0].sourceUrl,'/scenes/ABCD/images/image-001.png');
});
