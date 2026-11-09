(() => {
  const canvas = document.getElementById?.('unity-canvas');
  let requestSceneControl = () => canvas?.focus();
  // Deferred Unity cursor capture must consume a scene gesture, not a UI click.
  if (canvas?.requestPointerLock) {
    const requestLock = canvas.requestPointerLock.bind(canvas);
    let sceneGesture = false;
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown']) {
      window.addEventListener(type, event => { sceneGesture = event.target === canvas; }, true);
    }
    canvas.requestPointerLock = (...args) => {
      if (!sceneGesture) return;
      try { requestLock(...args)?.catch?.(() => {}); } catch {}
    };
    requestSceneControl = () => { sceneGesture = true; canvas.focus(); canvas.requestPointerLock(); };
  }
  let started = false;
  const editing = location.pathname.startsWith('/editor');
  const sounds = new Map(), uploads = [];
  let context, enabled = false, placementPending = false, placementId = null;
  let backgroundMenu = null, menuGlobalToggle = null;
  const pendingRemovals = new Set();
  function send(method, data) { window.toolkitAudioSend?.(method, typeof data === 'string' ? data : JSON.stringify(data)); }
  const toggle = document.createElement('button');
  toggle.id = 'scene-sound-toggle'; toggle.textContent = 'Unmute Sounds [M]';
  toggle.title = 'Mute or unmute all sound (M)';
  toggle.style.cssText = 'margin-top:8px;padding:8px 14px;border:1px solid #63738c;border-radius:20px;background:#24344f;color:#fff;font:600 13px system-ui;cursor:pointer';
  const toolbar = document.getElementById?.('save-panel');
  if (toolbar) toolbar.append(toggle);
  else {
    toggle.style.cssText += ';position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:30';
    document.body.append(toggle);
  }
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.style.cssText = 'position:fixed;top:90px;left:50%;transform:translateX(-50%);z-index:40;background:#172033;color:white;padding:12px;border-radius:10px;font:14px system-ui;max-width:80vw';
  status.hidden = true; document.body.append(status);
  function say(message) { status.textContent = message; status.hidden = !message; }
  function attenuation(snapshot) {
    if (snapshot.pendingPlacement || snapshot.audio.muted) return 0;
    if (!snapshot.audio.spatial) return snapshot.audio.volume;
    const p = snapshot.position, l = snapshot.listener;
    const distance = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
    return snapshot.audio.volume * Math.max(0, 1 - distance / snapshot.audio.radius);
  }
  let playbackProblem = null;
  async function reportPlaybackFailure(item, error) {
    if (error?.name === 'AbortError') return; // Muting/loading can cancel play().
    if (error?.name === 'NotAllowedError') {
      playbackProblem = item;
      say('Click Unmute Sounds to allow playback.');
      return;
    }
    let message;
    try {
      const response = await fetch(item.element.currentSrc || item.element.src || item.snapshot.sourceUrl,
        { method: 'HEAD', cache: 'no-store' });
      if (response.status === 404) message = 'The sound file is missing from this saved scene. Restore or re-add the recording, then save again.';
      else if (!response.ok) message = 'The sound file could not be loaded from the server.';
      else if (error?.name === 'NotSupportedError' || [3, 4].includes(item.element.error?.code))
        message = 'This browser could not decode the recording. Try another audio file.';
      else message = 'Sound playback was interrupted. Try turning sound off and on again.';
    } catch { message = 'The sound could not be loaded. Check the server connection and try again.'; }
    playbackProblem = item;
    say(message);
  }
  async function play(item) {
    try {
      await item.element.play();
      if (playbackProblem === item) { playbackProblem = null; say(''); }
    } catch (error) { await reportPlaybackFailure(item, error); }
  }
  function connect(item) {
    if (!context || item.gain) return;
    item.source = context.createMediaElementSource(item.element);
    item.gain = context.createGain(); item.gain.gain.value = attenuation(item.snapshot);
    item.source.connect(item.gain); item.gain.connect(context.destination);
  }
  async function enableSound() {
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      await context.resume(); enabled = true; syncGlobalSoundButtons();
      for (const item of sounds.values()) {
        connect(item);
        if (item.element.error) item.element.load();
        if (item.snapshot.audio.autoplay && !item.snapshot.pendingPlacement && item.element.paused) play(item);
      }
    } catch { say('Audio is unavailable in this browser.'); }
  }
  toggle.onclick = () => {
    if (!enabled) return enableSound();
    enabled = false; syncGlobalSoundButtons();
    for (const item of sounds.values()) item.element.pause();
  };
  function syncGlobalSoundButtons() {
    toggle.textContent = enabled ? 'Mute Sounds [M]' : 'Unmute Sounds [M]';
    if (menuGlobalToggle) menuGlobalToggle.textContent = enabled ? 'Mute all · M' : 'Enable sound · M';
  }
  // Scene entry is a browser-approved gesture for autoplay, including a saved
  // background loop. The explicit toggle remains available as a fallback.
  canvas?.addEventListener('pointerdown', () => { if (started && !context) enableSound(); });
  if (editing) canvas?.addEventListener('click', () => { if (started) send('HandleSceneAudioClick', ''); });

  const dialog = document.createElement('dialog');
  dialog.id = 'sound-choice'; dialog.setAttribute('aria-labelledby', 'sound-choice-title');
  dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(460px,calc(100vw - 48px));box-sizing:border-box;padding:28px;border:1px solid #53617b;border-radius:18px;background:#172033;color:#fff;font:16px/1.5 system-ui;text-align:center;box-shadow:0 20px 80px #0008';
  const heading = document.createElement('h2'); heading.id = 'sound-choice-title'; heading.textContent = 'How should this sound play?'; heading.style.margin = '0 0 12px';
  const description = document.createElement('p'); description.textContent = 'Choose a background loop or place a speaker in your scene.';
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Descriptive sound name';
  nameLabel.style.cssText = 'display:block;text-align:left;margin:20px 0;color:#d9e4f5;font-size:14px';
  const soundName = document.createElement('input'); soundName.id = 'sound-name'; soundName.type = 'text'; soundName.maxLength = 40; soundName.minLength = 3; soundName.required = true;
  soundName.placeholder = 'e.g. Rain, birds, market chatter'; soundName.autocomplete = 'off';
  soundName.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin-top:8px;padding:12px;border:1px solid #63738c;border-radius:9px;background:#0f192a;color:white;font:16px system-ui';
  const nameHint = document.createElement('small'); nameHint.id = 'sound-name-hint';
  nameHint.textContent = 'Required · 3–40 characters'; nameHint.style.cssText = 'display:block;margin-top:6px;color:#b8c7de';
  soundName.setAttribute('aria-describedby', nameHint.id);
  nameLabel.append(soundName, nameHint);
  const choices = document.createElement('div'); choices.style.cssText = 'display:grid;gap:12px;margin-top:20px';
  function choiceButton(text) {
    const button = document.createElement('button'); button.textContent = text;
    button.style.cssText = 'min-height:52px;padding:12px 18px;border:0;border-radius:10px;background:#2872e3;color:white;font:600 16px system-ui;cursor:pointer';
    choices.append(button); return button;
  }
  const background = choiceButton('Background sound');
  const located = choiceButton('Located sound');
  function updateNameValidity() {
    const length = soundName.value.trim().length;
    const valid = length >= 3 && length <= 40;
    soundName.setCustomValidity?.(valid ? '' : 'Enter a descriptive name of 3–40 characters.');
    for (const button of [background, located]) {
      button.disabled = !valid;
      button.style.opacity = valid ? '1' : '0.5';
      button.style.cursor = valid ? 'pointer' : 'not-allowed';
    }
    return valid;
  }
  soundName.oninput = updateNameValidity;
  const skip = choiceButton('Cancel'); skip.style.background = '#43516a';
  dialog.append(heading, description, nameLabel, choices); document.body.append(dialog);
  const css = document.createElement('style'); css.textContent = '#sound-choice::backdrop{background:rgb(0 0 0 / 60%)}'; document.body.append(css);
  let currentUpload = null;
  function closeChoice() {
    dialog.close(); currentUpload = null; send('SetSoundChoiceVisible', '0');
  }
  function showNext() {
    if (!started || !editing || currentUpload || backgroundMenu?.open || placementPending || !uploads.length) return;
    currentUpload = uploads.shift(); soundName.value = ''; updateNameValidity();
    document.exitPointerLock?.(); send('SetSoundChoiceVisible', '1');
    dialog.showModal(); soundName.focus?.();
  }
  function addSound(spatial) {
    if (!currentUpload) return;
    if (!updateNameValidity()) { soundName.reportValidity?.(); soundName.focus?.(); return; }
    if (sounds.size >= 16) { say('A scene can contain up to 16 sounds.'); return; }
    const sourceUrl = currentUpload.sourceUrl;
    const displayName = soundName.value.trim();
    closeChoice();
    placementPending = spatial;
    enableSound();
    send('AddSceneAudio', { sourceUrl, audio: { displayName, spatial, volume: 1, radius: 3, loop: true, autoplay: true } });
    if (spatial) requestSceneControl();
    else { say(''); showNext(); }
  }
  background.onclick = () => addSound(false);
  located.onclick = () => addSound(true);
  skip.onclick = () => { closeChoice(); showNext(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); skip.onclick(); });
  function updateGain(item) {
    if (item.gain) item.gain.gain.setTargetAtTime(attenuation(item.snapshot), context.currentTime, 0.05);
  }
  function changeBackground(item, changes) {
    item.snapshot.audio = { ...item.snapshot.audio, ...changes };
    updateGain(item);
    send('UpdateSceneAudio', { objectId: item.snapshot.objectId, audio: item.snapshot.audio });
    renderBackgrounds();
  }
  let backgroundList, backgroundEmpty;
  function createBackgroundRow(item) {
    const row = document.createElement('section');
    row.style.cssText = 'padding:18px 0;border-top:1px solid #43516a;text-align:left';
    const title = document.createElement('h3'); title.style.cssText = 'margin:0 0 14px;font-size:16px';
    const label = document.createElement('label'); label.textContent = 'Volume ';
    const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.step = '1';
    volume.style.cssText = 'width:65%;vertical-align:middle;accent-color:#65a7ff';
    const percent = document.createElement('span'); percent.style.cssText = 'display:inline-block;min-width:44px;text-align:right';
    label.append(volume, percent);
    volume.oninput = () => changeBackground(item, { volume: Number(volume.value) / 100 });
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;margin-top:14px';
    const mute = document.createElement('button');
    const remove = document.createElement('button'); remove.textContent = 'Remove';
    for (const button of [mute, remove]) button.style.cssText = 'padding:9px 16px;border:1px solid #63738c;border-radius:9px;background:#24344f;color:white;font:600 14px system-ui;cursor:pointer';
    mute.onclick = () => changeBackground(item, { muted: !item.snapshot.audio.muted });
    remove.onclick = () => {
      const id = item.snapshot.objectId;
      pendingRemovals.add(id);
      send('RemoveSceneAudio', id);
      window.toolkitAudio.remove(id);
    };
    actions.append(mute, remove); row.append(title, label, actions); backgroundList.append(row);
    item.backgroundControls = { row, title, volume, percent, mute, remove };
  }
  function renderBackgrounds() {
    if (!backgroundMenu?.open) return;
    let number = 0;
    const backgrounds = [...sounds.values()]
      .filter(item => !item.snapshot.audio.spatial && !item.snapshot.pendingPlacement)
      .sort((a, b) => a.snapshot.objectId.localeCompare(b.snapshot.objectId));
    for (const item of backgrounds) {
      number++;
      if (!item.backgroundControls) createBackgroundRow(item);
      const controls = item.backgroundControls;
      const name = item.snapshot.audio.displayName?.trim() || `Background sound ${number}`;
      controls.title.textContent = name;
      controls.volume.setAttribute('aria-label', `Volume for ${name}`);
      controls.volume.value = String(Math.round(item.snapshot.audio.volume * 100));
      controls.percent.textContent = controls.volume.value + '%';
      controls.mute.textContent = item.snapshot.audio.muted ? 'Unmute' : 'Mute';
      controls.mute.setAttribute('aria-label', `${item.snapshot.audio.muted ? 'Unmute' : 'Mute'} ${name}`);
      controls.mute.setAttribute('aria-pressed', String(Boolean(item.snapshot.audio.muted)));
      controls.remove.setAttribute('aria-label', `Remove ${name}`);
    }
    backgroundEmpty.hidden = number > 0;
    syncGlobalSoundButtons();
  }
  function openBackgrounds() {
    if (!started || !editing || currentUpload || backgroundMenu.open) return;
    document.exitPointerLock?.(); send('SetSoundChoiceVisible', '1');
    backgroundMenu.showModal(); renderBackgrounds();
  }
  function closeBackgrounds() {
    if (!backgroundMenu?.open) return;
    backgroundMenu.close(); send('SetSoundChoiceVisible', '0');
    showNext();
    if (!currentUpload) requestSceneControl();
  }
  if (editing) {
    const button = document.createElement('button'); button.id = 'background-sounds-button';
    button.textContent = 'Edit Background Sounds [B]'; button.title = 'Manage background sounds (B)';
    button.style.cssText = toggle.style.cssText;
    button.onclick = openBackgrounds;
    (toolbar || document.body).append(button);
    backgroundMenu = document.createElement('dialog'); backgroundMenu.id = 'background-sounds-menu';
    backgroundMenu.setAttribute('aria-labelledby', 'background-sounds-heading');
    backgroundMenu.style.cssText = dialog.style.cssText + ';width:min(540px,calc(100vw - 48px));max-height:80vh;overflow:auto';
    const title = document.createElement('h2'); title.id = 'background-sounds-heading'; title.textContent = 'Background sounds';
    title.style.cssText = 'margin:0 0 10px';
    const help = document.createElement('p'); help.textContent = 'Adjust each background loop. Changes are saved with your scene.';
    help.style.cssText = 'font-size:14px;color:#b8c7de';
    backgroundList = document.createElement('div'); backgroundList.id = 'background-sounds-list';
    backgroundEmpty = document.createElement('p'); backgroundEmpty.textContent = 'No background sounds in this scene.';
    const footer = document.createElement('div'); footer.style.cssText = 'display:flex;justify-content:space-between;gap:12px;margin-top:18px';
    menuGlobalToggle = document.createElement('button'); menuGlobalToggle.style.cssText = toggle.style.cssText;
    menuGlobalToggle.onclick = () => toggle.onclick();
    const done = document.createElement('button'); done.textContent = 'Done'; done.style.cssText = background.style.cssText;
    done.onclick = closeBackgrounds;
    footer.append(menuGlobalToggle, done);
    backgroundMenu.append(title, help, backgroundEmpty, backgroundList, footer); document.body.append(backgroundMenu);
    css.textContent += '#background-sounds-menu::backdrop{background:rgb(0 0 0 / 60%)}';
    backgroundMenu.addEventListener('cancel', event => { event.preventDefault(); closeBackgrounds(); });
    syncGlobalSoundButtons();
  }
  window.addEventListener('keydown', event => {
    if (!started) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key?.toLowerCase();
    if (key === 'm') {
      event.preventDefault(); event.stopImmediatePropagation(); toggle.onclick();
    } else if (editing && key === 'x') {
      if (currentUpload) return;
      event.preventDefault(); event.stopImmediatePropagation();
      location.href = '/';
    } else if (editing && (key === 'delete' || key === 'backspace')) {
      if (currentUpload || backgroundMenu?.open) return;
      const sceneFocused = Boolean(canvas && (event.target === canvas || document.pointerLockElement === canvas)) || event.target?.closest?.('#rotation-controls');
      if (!sceneFocused) return;
      event.preventDefault(); event.stopImmediatePropagation();
      send('DeleteSelectedObject', '');
    } else if (editing && key === 'b') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (backgroundMenu.open) closeBackgrounds(); else openBackgrounds();
    }
  }, true);
  const entry = document.createElement('div');
  entry.id = 'scene-start'; entry.hidden = true;
  entry.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#09132199;display:none;align-items:center;justify-content:center;text-align:center;color:white;font:18px/1.5 system-ui';
  const entryCard = document.createElement('div');
  entryCard.style.cssText = 'padding:36px 44px;border:1px solid #8498b5;border-radius:20px;background:#172033;box-shadow:0 20px 80px #0008;max-width:calc(100vw - 100px)';
  const startButton = document.createElement('button');
  startButton.textContent = 'Click to start';
  startButton.style.cssText = 'padding:18px 36px;border:0;border-radius:12px;background:#2872e3;color:white;font:700 28px system-ui;cursor:pointer';
  const entryHelp = document.createElement('p');
  entryHelp.textContent = 'Mouse to look · WASD to move · Q up / E down';
  entryHelp.style.cssText = 'margin:18px 0 0;color:#d9e4f5';
  entryCard.append(startButton, entryHelp); entry.append(entryCard); document.body.append(entry);
  entry.addEventListener('keydown', event => event.stopPropagation());
  const suspendedElements = [];
  startButton.onclick = event => {
    event?.stopPropagation?.();
    if (started) return;
    started = true; entry.hidden = true; entry.style.display = 'none';
    for (const [element, previous] of suspendedElements) element.inert = previous;
    send('StartSceneInteraction', '');
    requestSceneControl(); enableSound(); showNext();
  };
  window.toolkitAudio = {
    isWaitingToStart: () => !started,
    ready() {
      if (started || !entry.hidden) return;
      for (const element of document.body.children) {
        if (element === entry) continue;
        suspendedElements.push([element, element.inert]); element.inert = true;
      }
      send('SetSoundChoiceVisible', '1');
      entry.hidden = false; entry.style.display = 'flex'; startButton.focus();
    },
    chooseUpload(upload) { uploads.push(upload); showNext(); },
    update(snapshot) {
      if (pendingRemovals.has(snapshot.objectId)) return;
      let item = sounds.get(snapshot.objectId);
      const wasPending = item?.snapshot.pendingPlacement;
      if (!item) {
        item = { snapshot, element: new Audio() }; item.element.preload = 'none';
        item.element.src = snapshot.sourceUrl;
        item.element.addEventListener('error', () => reportPlaybackFailure(item));
        sounds.set(snapshot.objectId, item);
        if (enabled) { connect(item); if (snapshot.audio.autoplay && !snapshot.pendingPlacement) play(item); }
      }
      item.snapshot = snapshot; item.element.loop = snapshot.audio.loop;
      if (snapshot.pendingPlacement) { placementPending = true; placementId = snapshot.objectId; say(''); }
      else if (snapshot.objectId === placementId) {
        placementPending = false; placementId = null;
        if (enabled && wasPending && snapshot.audio.autoplay) play(item);
        showNext();
      }
      updateGain(item);
      renderBackgrounds();
    },
    remove(id) {
      const item = sounds.get(id);
      if (item) {
        item.element.pause(); item.element.removeAttribute('src'); item.element.load();
        item.source?.disconnect(); item.gain?.disconnect();
        item.backgroundControls?.row.remove(); sounds.delete(id);
      }
      renderBackgrounds();
      if (id === placementId || (placementPending && !placementId)) { placementPending = false; placementId = null; showNext(); }
    },
    count: () => sounds.size,
    attenuation
  };
  window.addEventListener('pagehide', () => { for (const id of [...sounds.keys()]) window.toolkitAudio.remove(id); context?.close(); });
})();
