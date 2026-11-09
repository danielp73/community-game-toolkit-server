const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const sharp = require('sharp');

test('large images save by reference, reopen, resave, and reject unsafe or missing sources without replacing the scene', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-image-reuse-'));
  const source = path.resolve(__dirname, '..');
  for (const file of ['server.js','scene-audio.js','audio-uploads.js']) fs.copyFileSync(path.join(source,file),path.join(root,file));
  fs.symlinkSync(path.dirname(path.dirname(require.resolve('express/package.json'))), path.join(root,'node_modules'));
  const launchDirectory = path.join(root, 'pm2-home');
  fs.mkdirSync(launchDirectory);
  const child = spawn(process.execPath,[path.join(root,'server.js')], { cwd:launchDirectory, env:{...process.env,PORT:'18263'},stdio:['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);
      child.stdout.on('data',data=>{if(data.toString().includes('Server running')){clearTimeout(timer);resolve();}});
      child.on('exit',code=>{clearTimeout(timer);reject(new Error('server exited '+code));});
    });
    const base='http://127.0.0.1:18263';
    const png=await sharp(randomBytes(1000*1000*3),{raw:{width:1000,height:1000,channels:3}}).png().toBuffer();
    assert.ok(png.length > 2_000_000);
    const session=await(await fetch(base+'/create-session',{method:'POST'})).json();
    const form=new FormData();form.append('image',new Blob([png],{type:'image/png'}),'photo.png');
    const upload=await fetch(`${base}/api/session/${session.sessionId}/upload`,{method:'POST',body:form});
    assert.equal(upload.status,200,await upload.clone().text());
    const {filename}=await upload.json();
    const original=fs.readFileSync(path.join(launchDirectory,'uploads',session.sessionId,filename));
    const scene={sceneId:'image-test',objects:[{objectId:'photo',type:'image',assetUrl:'images/image-001.png'}]};
    const save=async sourceUrl=>{
      const body=JSON.stringify({sceneJson:JSON.stringify(scene),images:[{fileName:'image-001.png',sourceUrl}]});
      assert.ok(Buffer.byteLength(body)<2048);
      return fetch(base+'/api/scenes/image-test/json',{method:'POST',headers:{'Content-Type':'application/json'},body});
    };
    let response=await save(`/uploads/${session.sessionId}/${filename}`);
    assert.equal(response.status,200,await response.text());
    const saved=()=>fs.readFileSync(path.join(root,'public/scenes/image-test/images/image-001.png'));
    assert.deepEqual(saved(),original);
    assert.deepEqual((await(await fetch(base+'/scenes/image-test/scene.json')).json()).objects,scene.objects);
    response=await save('/scenes/image-test/images/image-001.png?v=1');
    assert.equal(response.status,200,await response.text());assert.deepEqual(saved(),original);
    for(const bad of ['/uploads/missing/file.png',`/uploads/${session.sessionId}/%2e%2e%2fsecret.png`,'/server.js','https://example.com/private.png']) {
      response=await save(bad);assert.equal(response.status,400,await response.text());assert.deepEqual(saved(),original);
    }
    const folder=path.join(launchDirectory,'uploads',session.sessionId);
    fs.writeFileSync(path.join(folder,'fake.png'),'not png');
    fs.symlinkSync(path.join(folder,filename),path.join(folder,'linked.png'));
    for(const name of ['fake.png','linked.png']) {response=await save(`/uploads/${session.sessionId}/${name}`);assert.equal(response.status,400);}
    // Legacy base64 clients can still save after the server is updated.
    response=await fetch(base+'/api/scenes/image-test/json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneJson:JSON.stringify(scene),images:[{fileName:'image-001.png',base64Data:original.toString('base64')}]})});
    assert.equal(response.status,200,await response.text());assert.deepEqual(saved(),original);
  } finally { child.kill();fs.rmSync(root,{recursive:true,force:true}); }
});
