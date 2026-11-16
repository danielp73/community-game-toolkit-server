const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
  const html=fs.readFileSync(path.join(__dirname,'../public/editor/index.html'),'utf8');
  const start=html.indexOf('window.toolkitEditorSetComposePrompt =');
  const end=html.indexOf('window.toolkitEditorSetRotationMode =',start);
  const element=tag=>({tag,children:[],textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
  const composePrompt=element('div');const ctx={window:{},composePrompt,document:{createElement:element}};
  vm.runInNewContext(html.slice(start,end),ctx);return ctx;
}
test('object controls render separate rows and colored keyboard combinations',()=>{
  const b=setup();b.window.toolkitEditorSetComposePrompt('Click — Place wall · [ & ] — Scale · R — Turn 45° · Shift+D — Duplicate · Delete — Remove');
  assert.equal(b.composePrompt.hidden,false);assert.equal(b.composePrompt.children.length,5);
  assert.equal(b.composePrompt.children[0].children[1].textContent,'Place wall');
  assert.equal(b.composePrompt.children[2].children[0].children[0].textContent,'R');
  assert.equal(b.composePrompt.children[3].children[0].children.map(item=>item.textContent).join(''),'Shift+D');
  assert.equal(b.composePrompt.children[1].children[0].children.map(item=>item.textContent).join(''),'[/]');
  b.window.toolkitEditorSetComposePrompt('');assert.equal(b.composePrompt.hidden,true);assert.equal(b.composePrompt.children.length,0);
});
test('sound names stay intact and descriptions use literal text',()=>{
  const b=setup();b.window.toolkitEditorSetComposePrompt('Click — Move Birds · evening <img src=x> · Delete — Remove');
  assert.equal(b.composePrompt.children.length,2);
  assert.equal(b.composePrompt.children[0].children[1].textContent,'Move Birds · evening <img src=x>');
});
