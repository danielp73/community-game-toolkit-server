const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const sharp=require('sharp');
test('sphere upload, save, reopen, resave, replace, remove and reject invalid input',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolkit-skybox-'));
 for(const name of ['server.js','scene-audio.js','audio-uploads.js','scene-skybox.js'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(root,name));
 fs.symlinkSync(path.dirname(path.dirname(require.resolve('express/package.json'))),path.join(root,'node_modules'));
 const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,PORT:'18279'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('Server running')){clearTimeout(t);resolve();}});child.on('exit',c=>{clearTimeout(t);reject(Error('exit '+c));});});
  const base='http://127.0.0.1:18279';const session=await(await fetch(base+'/create-session',{method:'POST'})).json();
  const endpoint=base+`/api/session/${session.sessionId}/skybox`;
  const upload=async bytes=>{const data=new FormData();data.append('skybox',new Blob([bytes]),'sphere.jpg');return fetch(endpoint,{method:'POST',body:data});};
  const publish=body=>fetch(base+'/api/scenes/sphere-test/json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(const format of ['jpeg','png']){
   const bytes=await sharp({create:{width:256,height:128,channels:3,background:format==='jpeg'?'blue':'green'}})[format]().toBuffer();
   let r=await upload(bytes);assert.equal(r.status,200,await r.clone().text());const sphere=await r.json();
   assert.deepEqual(await(await fetch(endpoint)).json(),sphere);
   assert.deepEqual((await(await fetch(base+`/api/session/${session.sessionId}/uploads`)).json()).media,[]);
   const ext=format==='jpeg'?'jpg':'png',name=`skybox.${ext}`;
   const scene={sceneId:'sphere-test',objects:[{objectId:'skybox',type:'skybox',assetUrl:'skybox/'+name}]};
   const save=url=>publish({sceneJson:JSON.stringify(scene),images:[],skybox:[{fileName:name,sourceUrl:url}]});
   r=await save(sphere.sourceUrl);assert.equal(r.status,200,await r.clone().text());
   assert.deepEqual(await(await fetch(base+'/scenes/sphere-test/scene.json')).json(),scene);
   const committed='/scenes/sphere-test/skybox/'+name;
   assert.deepEqual(Buffer.from(await(await fetch(base+committed)).arrayBuffer()),bytes);
   r=await save(base+committed+'?v=2');assert.equal(r.status,200,await r.clone().text());
   for(const invalid of ['/uploads/_skyboxes/../../private.jpg','/uploads/_skyboxes/absent/skybox-missing.jpg']){
    r=await save(invalid);assert.equal(r.status,400);assert.deepEqual(await(await fetch(base+'/scenes/sphere-test/scene.json')).json(),scene);
   }
  }
  let r=await upload(Buffer.from('not an image'));assert.equal(r.status,400);
  r=await upload(await sharp({create:{width:100,height:100,channels:3,background:'red'}}).jpeg().toBuffer());assert.equal(r.status,400);
  r=await fetch(endpoint,{method:'DELETE'});assert.equal(r.status,200);assert.equal((await(await fetch(endpoint)).json()).sourceUrl,'');
  r=await publish({sceneJson:JSON.stringify({sceneId:'sphere-test',objects:[]}),images:[],skybox:[]});assert.equal(r.status,200);
  assert.equal(fs.existsSync(path.join(root,'public/scenes/sphere-test/skybox')),false);assert.deepEqual(fs.readdirSync(path.join(root,'tmp')),[]);
 }finally{child.kill();await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
});
