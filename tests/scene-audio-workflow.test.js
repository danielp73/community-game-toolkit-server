const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
for (const extension of ['wav', 'm4a']) test(`upload, publish, reopen, and resave ${extension} through server.js`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-scene-flow-'));
  const source = path.resolve(__dirname,'..');
  for (const name of ['server.js','scene-audio.js','audio-uploads.js']) fs.copyFileSync(path.join(source,name),path.join(root,name));
  const modules = require.resolve('express/package.json').replace(/\/express\/package.json$/, '');
  fs.symlinkSync(modules,path.join(root,'node_modules'));
  const child = spawn(process.execPath,[path.join(root,'server.js')], { cwd:root, env:{ ...process.env,PORT: extension === 'wav' ? '18261' : '18262' },stdio:['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);
      child.stdout.on('data',data=>{ if(data.toString().includes('Server running')){clearTimeout(timer);resolve();} });
      child.on('exit',code=>{ clearTimeout(timer);reject(new Error('server exited '+code)); });
    });
    const base=extension === 'wav' ? 'http://127.0.0.1:18261' : 'http://127.0.0.1:18262';
    const session=await (await fetch(base+'/create-session',{method:'POST'})).json();
    const wav=Buffer.alloc(48); wav.write('RIFF');wav.write('WAVE',8);
    const bytes = extension === 'm4a' ? fs.readFileSync(path.join(__dirname,'fixtures/test-tone.m4a')) : wav;
    const form=new FormData();form.append('audio',new Blob([bytes],{type: extension === 'm4a' ? 'audio/mp4' : 'audio/wav'}),`voice.${extension}`);
    const upload=await fetch(`${base}/api/session/${session.sessionId}/upload`,{method:'POST',body:form});
    assert.equal(upload.status,200); const {filename}=await upload.json();
    const scene={sceneId:'test-audio',title:'Audio test',objects:[{objectId:'sound1',type:'audio',assetUrl:`audio/sound.${extension}`,audio:{displayName:'Evening rain',spatial:true,volume:0.5,radius:8,loop:true,autoplay:true},transform:{position:{x:1,y:2,z:3}}}]};
    const save=async(sourceUrl)=>fetch(base+'/api/scenes/test-audio/json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneJson:JSON.stringify(scene),images:[],audio:[{fileName:`sound.${extension}`,sourceUrl}]})});
    let response=await save(`${base}/uploads/${session.sessionId}/${filename}`);
    assert.equal(response.status,200,await response.text());
    const restored=await (await fetch(base+'/scenes/test-audio/scene.json')).json();
    assert.deepEqual(restored.objects,scene.objects);
    const savedBytes=Buffer.from(await (await fetch(base+`/scenes/test-audio/audio/sound.${extension}`)).arrayBuffer());
    assert.deepEqual(savedBytes,bytes);
    scene.objects[0].audio.spatial=false;
    scene.objects[0].audio.volume=0.25; scene.objects[0].audio.muted=true;
    response=await save(base+`/scenes/test-audio/audio/sound.${extension}?v=2`);
    assert.equal(response.status,200,await response.text());
    const latest=await(await fetch(base+'/scenes/test-audio/scene.json')).json();
    assert.equal(latest.objects[0].audio.spatial,false); assert.equal(latest.objects[0].audio.volume,0.25); assert.equal(latest.objects[0].audio.muted,true); assert.equal(latest.objects[0].audio.displayName,'Evening rain');
    response=await save('/uploads/session/absent.wav'); assert.equal(response.status,400);
    assert.equal((await(await fetch(base+'/scenes/test-audio/scene.json')).json()).objects[0].audio.spatial,false);
  } finally {child.kill();fs.rmSync(root,{recursive:true,force:true});}
});
