import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/una-mount.js',import.meta.url),'utf8');
class Node {
  constructor(tag){this.tag=tag;this.childNodes=[];this.events=new Map();}
  append(...nodes){for(const node of nodes){node.remove();this.childNodes.push(node);node.parentNode=this;}}
  insertBefore(node,anchor){node.remove();const index=this.childNodes.indexOf(anchor);if(index<0)throw new Error('Missing anchor');this.childNodes.splice(index,0,node);node.parentNode=this;}
  remove(){if(this.parentNode){const a=this.parentNode.childNodes;a.splice(a.indexOf(this),1);this.parentNode=null;}}
  contains(node){return this.childNodes.some(c=>c===node||c.contains(node));}
  addEventListener(type,fn){this.events.set(type,fn);}
}
function harness(){
  const source=new Node('section');source.id='entityTab-reports';
  const text=new Node('#text'),input=new Node('input'),button=new Node('button');
  input.value='2026-10-01';let clicks=0;button.addEventListener('click',()=>clicks++);
  source.append(text,input,button);
  const document={getElementById:id=>id===source.id?source:null,createComment:()=>new Node('#comment'),createElement:tag=>new Node(tag)};
  const window={dispatchEvent(){}};
  vm.runInNewContext(readFileSync(new URL('../public/una-mount.js',import.meta.url),'utf8'),{window,document,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
  return {api:window.UnaMount,source,text,input,button,pin:new Node('section'),workspace:new Node('section'),clicks:()=>clicks};
}
test('pin and Workspace share exact nodes, preserving input values and one listener',()=>{
  const h=harness();
  h.api.claim('entity:reports',h.pin,'pin');
  assert.equal(h.pin.childNodes[1],h.input);
  h.input.value='2026-10-08';
  h.api.claim('entity:reports',h.workspace,'workspace');
  assert.equal(h.workspace.childNodes[1],h.input);
  assert.equal(h.input.value,'2026-10-08');
  assert.equal(h.api.owner('entity:reports'),'workspace');
  h.button.events.get('click')();assert.equal(h.clicks(),1);
  const placeholder=h.pin.childNodes.find(n=>n.tag==='div');
  placeholder.childNodes[0].events.get('click')();
  assert.equal(h.pin.childNodes[1],h.input);
  assert.equal(h.api.owner('entity:reports'),'pin');
  assert.equal(h.workspace.childNodes.some(n=>n===h.input),false);
});
test('release restores interleaved source nodes at their original positions',()=>{
  const h=harness(),original=[...h.source.childNodes];
  h.api.claim('entity:reports',h.workspace,'workspace');
  h.api.release('entity:reports');
  assert.deepEqual(h.source.childNodes,original);
  assert.equal(h.workspace.childNodes.length,0);
  assert.equal(h.api.owner('entity:reports'),'menu');
});
test('claiming an already owned location is idempotent and reset restores all nodes',()=>{
  const h=harness();
  h.api.claim('entity:reports',h.pin,'pin');
  h.api.claim('entity:reports',h.pin,'pin');
  assert.equal(h.pin.childNodes.length,3);
  h.api.reset();assert.equal(h.source.childNodes.length,3);assert.equal(h.pin.childNodes.length,0);
  assert.throws(()=>h.api.claim('entity:missing',h.pin,'pin'));
  assert.throws(()=>h.api.claim('entity:reports',h.pin,'model'));
});
test('removing a pin while Workspace owns the panel never steals or drops the original nodes',()=>{
  const h=harness();h.api.claim('entity:reports',h.pin,'pin');h.api.claim('entity:reports',h.workspace,'workspace');
  h.api.detach('entity:reports',h.pin);
  assert.equal(h.api.owner('entity:reports'),'workspace');assert.equal(h.workspace.childNodes[1],h.input);
  h.api.detach('entity:reports',h.workspace);
  assert.equal(h.api.owner('entity:reports'),'menu');assert.equal(h.source.childNodes.filter(n=>n===h.input).length,1);
});
