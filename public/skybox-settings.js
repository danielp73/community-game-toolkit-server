(() => {
  if (!location.pathname.startsWith('/editor')) return;
  const toolbar = document.getElementById('save-panel');
  if (!toolbar) return;
  const send = (method, value = '') => window.toolkitAudioSend?.(method, value);
  const panel = document.createElement('dialog');
  panel.id = 'skybox-settings';
  panel.style.cssText = 'width:min(440px,calc(100vw - 48px));box-sizing:border-box;padding:28px;border:1px solid #8497b8;border-radius:18px;background:#232b46;color:#f4f6fc;font:16px/1.5 system-ui';
  const style = document.createElement('style');
  style.textContent = '#skybox-settings::backdrop{background:#0009}#skybox-settings button{padding:10px 14px;margin:4px;border:1px solid #8497b8;border-radius:8px;background:#344766;color:white;font:inherit;cursor:pointer}#skybox-settings button:disabled{opacity:.4;cursor:not-allowed}#skybox-settings .skybox-action{display:block;width:100%;margin:12px 0}';
  document.head.append(style);
  const title = document.createElement('h2'); title.textContent = 'Skybox settings';
  const label = document.createElement('label'); label.textContent = 'Solid colour ';
  const picker = document.createElement('input'); picker.type = 'color'; picker.value = '#87ceeb'; picker.setAttribute('aria-label','Choose skybox colour'); label.append(picker);
  const presets = document.createElement('div'); presets.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:16px 0';
  function applyColour(hex) { picker.value = hex; send('SetSolidSkybox', hex); }
  picker.addEventListener('input', () => applyColour(picker.value));
  for (const [name, hex] of [['White','#ffffff'],['Black','#000000'],['Grey','#808080'],['Blue','#87ceeb'],['Green','#8fbc8f'],['Yellow','#ffe4a0'],['Pink','#efb4cf'],['Purple','#9d8ac7']]) {
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.title = name; swatch.setAttribute('aria-label', name);
    swatch.style.cssText = `background:${hex};width:38px;height:38px;padding:0;margin:0;border:2px solid #c7d2e8`;
    swatch.onclick = () => applyColour(hex); presets.append(swatch);
  }
  const status = document.createElement('p'); status.setAttribute('role','status');
  status.style.cssText = 'display:none;position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10000;box-sizing:border-box;width:max-content;max-width:calc(100vw - 32px);margin:0;padding:12px 20px;border-radius:10px;background:#b00020;color:white;box-shadow:0 4px 18px #0005;font:600 16px/1.4 system-ui;text-align:center;pointer-events:none';
  let statusTimer;
  function notify(message) {
    clearTimeout(statusTimer); status.textContent=message; status.style.display='block';
    statusTimer=setTimeout(() => {status.style.display='none';}, 4000);
  }
  function action(text, handler) { const button = document.createElement('button'); button.type='button';button.className='skybox-action';button.textContent=text;button.onclick=handler;panel.append(button); return button; }
  function close(resume = true) { panel.close();send('SetSoundChoiceVisible','0');if(resume)window.toolkitAudio?.resumeControls?.(); }
  panel.append(title,label,presets,status);
  action('Remove skybox — return to default', () => { send('SetUploadedSkybox',JSON.stringify({sourceUrl:''})); });
  let restoring = false;
  const restore = action('Restore my own skybox', () => {
    if (restore.disabled) return;
    restoring = true; restore.disabled = true; send('RestoreOwnSkybox');
  });
  function syncRestore() { restore.disabled = restoring || !window.toolkitSkyboxHasImage; }
  window.toolkitSkyboxResult = error => {
    if (!error) window.toolkitSkyboxHasImage = true;
    restoring = false; syncRestore();
  };
  syncRestore();
  const sceneCode = new URLSearchParams(location.search).get('scene');
  if (sceneCode) fetch('/scenes/' + encodeURIComponent(sceneCode) + '/scene.json', {cache:'no-store'})
    .then(response => response.ok ? response.json() : null)
    .then(scene => {
      if (window.toolkitSkyboxHasImage === undefined)
        window.toolkitSkyboxHasImage = Boolean(scene?.objects?.some(object => object.type === 'skybox' && object.assetUrl));
      syncRestore();
    }).catch(() => syncRestore());
  action('Add a new skybox', () => {
    const session = window.toolkitSkyboxSessionUrl;
    if (!session) {notify('The upload session is still connecting. Please try again shortly.');return;}
    const url = new URL(session, location.href);url.searchParams.set('tab','skybox');
    window.open(url.href,'toolkit-image-upload');close(false);
  });
  action('Done', () => close());
  panel.addEventListener('cancel', event => {event.preventDefault();close();});
  let backdropPress = false;
  function outsidePanel(event) {
    const bounds = panel.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  panel.addEventListener('pointerdown', event => {
    backdropPress = event.target === panel && outsidePanel(event);
  });
  panel.addEventListener('click', event => {
    if (backdropPress && event.target === panel && outsidePanel(event)) {
      event.preventDefault(); event.stopPropagation(); close();
    }
    backdropPress = false;
  });

  document.body.append(panel);
  const button = document.createElement('button');button.id='skybox-settings-button';
  const key = document.createElement('kbd');key.className='control-tip-key';key.textContent='K';
  const text = document.createElement('span');text.textContent='Skybox Settings';button.append(key,text);
  button.onclick = () => {
    if(window.toolkitAudio?.isWaitingToStart() || window.toolkitAudio?.isPlaying() || document.querySelector('dialog[open]'))return;
    send('SetSoundChoiceVisible','1');document.exitPointerLock?.();panel.showModal();
  };
  toolbar.insertBefore(button,document.getElementById('quit-hint'));
  window.addEventListener('keydown', event => {
    if(panel.open) {if(event.key==='Escape'){event.preventDefault();close();}event.stopImmediatePropagation();return;}
    if(event.key.toLowerCase()!=='k'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    event.preventDefault();event.stopImmediatePropagation();button.onclick();
  },true);
})();
