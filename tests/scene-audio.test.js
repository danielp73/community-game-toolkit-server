const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { prepareSceneAudio, copySceneAudio } = require('../scene-audio');
function wav() {
  const data = Buffer.alloc(16044); data.write('RIFF'); data.writeUInt32LE(data.length - 8,4); data.write('WAVEfmt ',8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(8000,24); data.writeUInt32LE(16000,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(16000,40); return data;
}
function data() { return { objects: [{ objectId: 'sound1', type: 'audio', assetUrl: 'audio/sound.wav', audio: { spatial: true, volume: 0.75, radius: 10, loop: true, autoplay: true }, transform: { position: { x: 0, y: 1, z: 2 } } }] }; }
test('publishing copies exact audio bytes and can resave from a saved scene', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-audio-'));
  try {
    fs.mkdirSync(path.join(root,'uploads/session'), { recursive: true });
    fs.writeFileSync(path.join(root,'uploads/session/original.wav'), wav());
    const files = prepareSceneAudio(data(), [{ fileName: 'sound.wav', sourceUrl: 'http://localhost/uploads/session/original.wav' }], root);
    const stage = path.join(root,'public/scenes/demo'); fs.mkdirSync(stage, { recursive: true });
    copySceneAudio(files, stage);
    assert.deepEqual(fs.readFileSync(path.join(stage,'audio/sound.wav')), wav());
    assert.equal(prepareSceneAudio(data(), [{ fileName: 'sound.wav', sourceUrl: '/scenes/demo/audio/sound.wav?v=123' }], root).size, 1);
    assert.throws(() => prepareSceneAudio(data(), [], root), /missing/);
    assert.throws(() => prepareSceneAudio(data(), [{ fileName: '../escape.wav', sourceUrl: '/uploads/session/original.wav' }], root), /filename/);
    assert.throws(() => prepareSceneAudio(data(), [{ fileName: 'sound.wav', sourceUrl: '/uploads/session/%2e%2e%2fsecret.wav' }], root), /session or a saved scene/);
    const bad = data(); bad.objects[0].audio.radius = -1;
    assert.throws(() => prepareSceneAudio(bad, [{ fileName:'sound.wav',sourceUrl:'/uploads/session/original.wav' }], root), /settings/);
    assert.throws(() => prepareSceneAudio(data(), Array(17).fill({}), root), /16 sounds/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
function browser(canvas, options = {}) {
  const elements = [], handlers = {}, audios = [], sent = [], gains = [];
  function element() {
    const item = { style: {}, children: [], textContent: '', handlers: {},
      append(...items) { this.children.push(...items); }, setAttribute() {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.removed = true; }
    }; elements.push(item); return item;
  }
  class Audio {
    constructor() { this.paused = true; this.playCalls = 0; this.handlers = {}; audios.push(this); }
    addEventListener(type, handler) { this.handlers[type] = handler; } play() { if (this.playFailure) return Promise.reject(this.playFailure); this.paused = false; this.playCalls++; return Promise.resolve(); }
    pause() { this.paused = true; } removeAttribute() {} load() {}
  }
  class AudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; }
    async resume() {} close() {} createMediaElementSource() { return { connect() {}, disconnect() {} }; }
    createGain() { const item = { gain: { value: 0, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; gains.push(item); return item; }
  }
  const body = element();
  const ctx = { location: { pathname: '/editor/', href: 'http://localhost/editor/' }, Audio, URL,
    fetch: async () => { if (options.offline) throw new Error('offline'); return { status: options.status || 200, ok: !options.status || options.status === 200 }; },
    document: { body, createElement: element, getElementById: id => id === 'unity-canvas' ? canvas : undefined },
    window: { AudioContext, addEventListener(type, handler) { handlers[type] = handler; }, toolkitAudioSend(...args) { sent.push(args); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/scene-audio.js'),'utf8'), ctx);
  if (!options.waitForStart) {
    ctx.window.toolkitAudio.ready();
    elements.find(item => item.id === 'scene-start').children[0].children[0].onclick();
    sent.length = 0;
  }
  return { ...ctx, sent, handlers, audios, elements, gains,
    toggle: elements.find(item => item.id === 'scene-sound-toggle'),
    dialog: elements.find(item => item.id === 'sound-choice'),
    soundName: elements.find(item => item.id === 'sound-name'),
    status: elements.find(item => item.style.cssText?.includes('top:90px')),
    backgroundMenu: elements.find(item => item.id === 'background-sounds-menu'),
    backgroundButton: elements.find(item => item.id === 'background-sounds-button'),
    backgroundList: elements.find(item => item.id === 'background-sounds-list') };
}
function snapshot(pendingPlacement = false) {
  return { objectId: 'one', sourceUrl: 'http://localhost/uploads/session/test.wav',
    pendingPlacement, audio: { spatial: true, volume: 0.8, radius: 10, autoplay: true, loop: true },
    position: { x:0,y:0,z:0 }, listener: { x:5,y:0,z:0 } };
}
test('centered upload choice creates an autoplaying background loop without a corner panel', async () => {
  const b = browser();
  assert.equal(b.elements.some(item => item.id === 'scene-sound-panel'), false);
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/test.wav', filename: 'test.wav' });
  assert.equal(b.dialog.open, true);
  assert.equal(b.sent[0][0], 'SetSoundChoiceVisible'); assert.equal(b.sent[0][1], '1');
  b.soundName.value = 'Test recording'; b.soundName.oninput(); b.dialog.children[3].children[0].onclick();
  await new Promise(setImmediate);
  assert.equal(b.dialog.open, false);
  const added = JSON.parse(b.sent.find(call => call[0] === 'AddSceneAudio')[1]);
  assert.equal(added.audio.spatial, false); assert.equal(added.audio.loop, true); assert.equal(added.audio.autoplay, true);
  const sound = snapshot(); sound.audio.spatial = false;
  b.window.toolkitAudio.update(sound);
  assert.equal(b.audios[0].playCalls, 1); assert.equal(b.audios[0].loop, true);
});
test('located sound stays muted while carrying and queues choices until placement finishes', async () => {
  const b = browser();
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
  b.soundName.value = 'Test recording'; b.soundName.oninput(); b.dialog.children[3].children[1].onclick(); await new Promise(setImmediate);
  assert.equal(JSON.parse(b.sent.find(call => call[0] === 'AddSceneAudio')[1]).audio.spatial, true);
  b.window.toolkitAudio.update(snapshot(true));
  assert.equal(b.audios[0].playCalls, 0); assert.equal(b.window.toolkitAudio.attenuation(snapshot(true)), 0);
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/two.wav', filename: 'two.wav' });
  assert.equal(b.dialog.open, false);
  b.window.toolkitAudio.update(snapshot(false));
  assert.equal(b.audios[0].playCalls, 1); assert.equal(b.dialog.open, true);
});
test('background and located sound attenuation remains correct', () => {
  const b = browser(), sound = snapshot();
  assert.equal(b.window.toolkitAudio.attenuation(sound), 0.4);
  sound.listener.x = 10; assert.equal(b.window.toolkitAudio.attenuation(sound), 0);
  sound.listener.x = 30; assert.equal(b.window.toolkitAudio.attenuation(sound), 0);
  sound.audio.spatial = false; assert.equal(b.window.toolkitAudio.attenuation(sound), 0.8);
});
test('only scene clicks place sounds and capture the pointer', () => {
  let locked = 0; const events = {};
  const canvas = { focus() {}, addEventListener(type, handler) { events[type] = handler; }, requestPointerLock() { locked++; return Promise.resolve(); } };
  const b = browser(canvas);
  locked = 0; // Scene entry already requested capture.
  b.handlers.click({ target: {} }); canvas.requestPointerLock(); assert.equal(locked, 0);
  b.handlers.click({ target: canvas }); canvas.requestPointerLock(); assert.equal(locked, 1);
  events.click(); assert.equal(b.sent.at(-1)[0], 'HandleSceneAudioClick');
});

test('cancel skips an upload and cancelling a carried sound releases the next choice', async () => {
  const b = browser();
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/skip.wav', filename: 'skip.wav' });
  b.dialog.children[3].children[2].onclick();
  assert.equal(b.sent.some(call => call[0] === 'AddSceneAudio'), false);
  assert.equal(b.dialog.open, false);
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
  b.soundName.value = 'Test recording'; b.soundName.oninput(); b.dialog.children[3].children[1].onclick(); await new Promise(setImmediate);
  b.window.toolkitAudio.update(snapshot(true));
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/two.wav', filename: 'two.wav' });
  b.window.toolkitAudio.remove('one');
  assert.equal(b.window.toolkitAudio.count(), 0); assert.equal(b.dialog.open, true);
});

test('missing saved M4A is diagnosed as a missing file, and retry clears the warning', async () => {
  const b = browser(undefined, { status: 404 });
  const sound = snapshot(); sound.sourceUrl = 'http://localhost/scenes/ABCD/audio/missing.m4a';
  b.window.toolkitAudio.update(sound);
  b.audios[0].playFailure = { name: 'NotSupportedError' };
  await b.toggle.onclick(); await new Promise(setImmediate);
  assert.match(b.status.textContent, /missing from this saved scene/);
  assert.doesNotMatch(b.status.textContent, /decode|MP3/);
  b.audios[0].playFailure = null;
  b.toggle.onclick(); await b.toggle.onclick(); await new Promise(setImmediate);
  assert.equal(b.status.hidden, true);
});
test('play cancellation is quiet and genuine decoder errors are distinguished', async () => {
  const b = browser(); b.window.toolkitAudio.update(snapshot());
  b.audios[0].playFailure = { name: 'AbortError' };
  await b.toggle.onclick(); await new Promise(setImmediate); assert.equal(b.status.hidden, true);
  b.audios[0].error = { code: 3 };
  await b.audios[0].handlers.error(); assert.match(b.status.textContent, /could not decode/);
});

function backgroundSnapshot(id, volume) {
  const sound = snapshot(); sound.objectId = id; sound.audio.spatial = false;
  sound.audio.volume = volume; sound.audio.muted = false; return sound;
}
function shortcut(key, target = {}) { return { key, target, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} }; }
test('B menu mixes only background sounds, preserves volume on mute, and removes one sound', async () => {
  const b = browser();
  b.window.toolkitAudio.update(backgroundSnapshot('one', 0.8));
  b.window.toolkitAudio.update(backgroundSnapshot('two', 0.3));
  const local = snapshot(); local.objectId = 'local'; b.window.toolkitAudio.update(local);
  await b.toggle.onclick();
  b.handlers.keydown(shortcut('b'));
  assert.equal(b.backgroundMenu.open, true); assert.equal(b.backgroundList.children.length, 2);
  const row = b.backgroundList.children[0], slider = row.children[1].children[0];
  slider.value = '35'; slider.oninput();
  let change = JSON.parse(b.sent.filter(call => call[0] === 'UpdateSceneAudio').at(-1)[1]);
  assert.equal(change.objectId, 'one'); assert.equal(change.audio.volume, 0.35);
  const mute = row.children[2].children[0]; mute.onclick();
  change = JSON.parse(b.sent.filter(call => call[0] === 'UpdateSceneAudio').at(-1)[1]);
  assert.equal(change.audio.muted, true); assert.equal(change.audio.volume, 0.35); assert.equal(b.gains[0].gain.value, 0);
  mute.onclick(); assert.equal(b.gains[0].gain.value, 0.35);
  const removedRow = b.backgroundList.children[1]; removedRow.children[2].children[1].onclick();
  assert.equal(b.sent.some(call => call[0] === 'RemoveSceneAudio' && call[1] === 'two'), true);
  assert.equal(b.window.toolkitAudio.count(), 2); assert.equal(removedRow.removed, true);
  b.window.toolkitAudio.update(backgroundSnapshot('two', 0.3)); assert.equal(b.window.toolkitAudio.count(), 2);
  b.handlers.keydown(shortcut('B')); assert.equal(b.backgroundMenu.open, false);
  assert.deepEqual(b.sent.filter(call => call[0] === 'SetSoundChoiceVisible').map(call => call[1]), ['1', '0']);
});
test('M globally toggles playback while preserving individual saved mute settings', async () => {
  const b = browser(); const muted = backgroundSnapshot('one', 0.6); muted.audio.muted = true;
  b.window.toolkitAudio.update(muted); b.window.toolkitAudio.update(backgroundSnapshot('two', 0.4));
  b.handlers.keydown(shortcut('m')); await new Promise(setImmediate);
  assert.equal(b.toggle.textContent, 'Mute Sounds [M]'); assert.equal(b.gains[0].gain.value, 0); assert.equal(b.gains[1].gain.value, 0.4);
  b.handlers.keydown(shortcut('M')); assert.equal(b.audios[0].paused, true); assert.equal(b.audios[1].paused, true);
  b.handlers.keydown(shortcut('m')); await new Promise(setImmediate);
  assert.equal(b.gains[0].gain.value, 0); assert.equal(b.gains[1].gain.value, 0.4);
  assert.equal(b.sent.some(call => call[0] === 'UpdateSceneAudio'), false);
  const typed = shortcut('m', { closest() { return {}; } }); b.handlers.keydown(typed); assert.equal(typed.prevented, undefined);
  b.handlers.keydown({ ...shortcut('b'), ctrlKey: true }); assert.notEqual(b.backgroundMenu.open, true);
});
test('opening B menu queues new uploads until the menu closes', () => {
  const b = browser(); b.backgroundButton.onclick();
  const empty = b.backgroundMenu.children[2]; assert.equal(empty.hidden, false);
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/next.wav', filename: 'next.wav' });
  assert.notEqual(b.dialog.open, true);
  b.backgroundMenu.children[4].children[1].onclick();
  assert.equal(b.backgroundMenu.open, false); assert.equal(b.dialog.open, true);
});

test('sound-choice name is trimmed, bounded, and supplied for either sound mode', () => {
  for (const index of [0, 1]) {
    const b = browser(); b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
    b.soundName.value = '  Evening rain  '; b.dialog.children[3].children[index].onclick();
    const message = JSON.parse(b.sent.find(call => call[0] === 'AddSceneAudio')[1]);
    assert.equal(message.audio.displayName, 'Evening rain');
    assert.equal(message.audio.spatial, index === 1);
  }
  const b = browser(); b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
  b.soundName.value = 'x'.repeat(100); b.dialog.children[3].children[0].onclick();
  assert.equal(b.sent.some(call => call[0] === 'AddSceneAudio'), false); assert.equal(b.dialog.open, true);
});
test('named background labels stay attached to their objects in a different loading order', () => {
  for (const reverse of [false, true]) {
    const b = browser();
    const rain = backgroundSnapshot('rain', 0.5); rain.audio.displayName = 'Rain on the roof';
    const birds = backgroundSnapshot('birds', 0.8); birds.audio.displayName = 'Birdsong';
    for (const sound of reverse ? [birds, rain] : [rain, birds]) b.window.toolkitAudio.update(sound);
    b.backgroundButton.onclick();
    assert.deepEqual(b.backgroundList.children.map(row => row.children[0].textContent), ['Birdsong', 'Rain on the roof']);
    b.backgroundList.children[1].children[1].children[0].value = '25';
    b.backgroundList.children[1].children[1].children[0].oninput();
    const changed = JSON.parse(b.sent.filter(call => call[0] === 'UpdateSceneAudio').at(-1)[1]);
    assert.equal(changed.objectId, 'rain'); assert.equal(changed.audio.displayName, 'Rain on the roof');
  }
});
test('unnamed sounds use consistent ordering and new sounds cannot use a blank name', () => {
  const b = browser(); b.window.toolkitAudio.update(backgroundSnapshot('z-last', 0.2)); b.window.toolkitAudio.update(backgroundSnapshot('a-first', 0.5));
  b.backgroundButton.onclick();
  b.backgroundList.children[0].children[2].children[0].onclick();
  assert.equal(JSON.parse(b.sent.filter(call => call[0] === 'UpdateSceneAudio').at(-1)[1]).objectId, 'a-first');
  const fresh = browser(); fresh.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
  fresh.soundName.value = '  '; fresh.dialog.children[3].children[0].onclick();
  assert.equal(fresh.sent.some(call => call[0] === 'AddSceneAudio'), false); assert.equal(fresh.dialog.open, true);
});

test('both sound choices require a trimmed name of 3–40 characters', () => {
  for (const name of ['', '  ', 'ab', 'x'.repeat(41)]) {
    const b = browser(); b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
    b.soundName.value = name; b.soundName.oninput();
    for (const index of [0, 1]) {
      const button = b.dialog.children[3].children[index]; assert.equal(button.disabled, true); button.onclick();
    }
    assert.equal(b.sent.some(call => call[0] === 'AddSceneAudio'), false); assert.equal(b.dialog.open, true);
  }
  for (const name of ['Rain', 'x'.repeat(40)]) {
    const b = browser(); b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
    b.soundName.value = name; b.soundName.oninput();
    assert.equal(b.dialog.children[3].children[0].disabled, false); assert.equal(b.dialog.children[3].children[1].disabled, false);
    b.dialog.children[3].children[0].onclick();
    assert.equal(JSON.parse(b.sent.find(call => call[0] === 'AddSceneAudio')[1]).audio.displayName, name);
  }
});

test('Delete and Mac Backspace remove only the selected scene object', () => {
  const canvas = { focus() {}, addEventListener() {} }; const b = browser(canvas);
  for (const key of ['Delete', 'Backspace']) {
    const event = shortcut(key, canvas); b.handlers.keydown(event);
    assert.equal(event.prevented, true); assert.equal(b.sent.at(-1)[0], 'DeleteSelectedObject');
  }
  const count = b.sent.length;
  b.handlers.keydown(shortcut('Delete', { closest() { return {}; } }));
  b.handlers.keydown(shortcut('Delete', {}));
  b.handlers.keydown({ ...shortcut('Delete', canvas), repeat: true });
  b.handlers.keydown({ ...shortcut('Delete', canvas), metaKey: true });
  assert.equal(b.sent.length, count);
  b.backgroundButton.onclick(); const menuCount = b.sent.length;
  b.handlers.keydown(shortcut('Delete', canvas)); assert.equal(b.sent.length, menuCount);
});
test('Delete ignores the upload naming dialog and supports a held image rotation control', () => {
  const canvas = { focus() {}, addEventListener() {} }; const b = browser(canvas);
  const rotationButton = { closest(selector) { return selector === '#rotation-controls' ? {} : null; } };
  b.handlers.keydown(shortcut('Delete', rotationButton)); assert.equal(b.sent.at(-1)[0], 'DeleteSelectedObject');
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/one.wav', filename: 'one.wav' });
  const count = b.sent.length; b.handlers.keydown(shortcut('Delete', canvas)); assert.equal(b.sent.length, count);
});

test('scene entry starts playback without forwarding the first click to selection', async () => {
  const canvas = { focus() {}, addEventListener(type, handler) { this[type] = handler; } };
  const b = browser(canvas, { waitForStart: true });
  b.window.toolkitAudio.update(snapshot());
  b.window.toolkitAudio.ready();
  const entry = b.elements.find(item => item.id === 'scene-start');
  assert.equal(entry.hidden, false);
  canvas.click();
  b.handlers.keydown({ key: 'b' });
  b.handlers.keydown({ key: 'Delete', target: canvas });
  b.window.toolkitAudio.chooseUpload({ sourceUrl: '/uploads/queued.wav' });
  assert.equal(b.dialog.open, undefined);
  assert.equal(b.backgroundMenu.open, undefined);
  assert.equal(b.sent.some(call => call[0] === 'DeleteSelectedObject'), false);
  assert.equal(b.sent.some(call => call[0] === 'HandleSceneAudioClick'), false);
  entry.children[0].children[0].onclick();
  await new Promise(setImmediate);
  assert.equal(entry.hidden, true);
  assert.equal(b.dialog.open, true);
  b.dialog.children[3].children[2].onclick();
  assert.equal(b.audios[0].playCalls, 1);
  assert.equal(b.sent.some(call => call[0] === 'StartSceneInteraction'), true);
  canvas.click();
  assert.equal(b.sent.filter(call => call[0] === 'HandleSceneAudioClick').length, 1);
  b.window.toolkitAudio.ready();
  assert.equal(entry.hidden, true);
});

test('X quits the scene while naming fields keep normal typing', () => {
  const b = browser();
  const event = { key: 'x', preventDefault() {}, stopImmediatePropagation() {} };
  b.handlers.keydown({ ...event, target: { closest: () => true } });
  assert.equal(b.location.href, 'http://localhost/editor/');
  b.handlers.keydown(event);
  assert.equal(b.location.href, '/');
});
