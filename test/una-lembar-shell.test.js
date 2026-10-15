import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Minimal DOM contract for lifecycle races. Browser layout is checked separately.
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={};this.className='';this.listeners=new Map();this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>{if(!this.classList.contains(c))this.className+=' '+c;},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ');}};}
  get childNodes(){return this.children;}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
  insertBefore(n,anchor){n.remove();const i=this.children.indexOf(anchor);if(i<0)throw new Error('Missing anchor');n.parentNode=this;this.children.splice(i,0,n);}
  before(n){this.parentNode.insertBefore(n,this);}
  remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...nodes){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...nodes);}
  contains(n){return all(this).includes(n);}
  querySelector(selector){return all(this).find(n=>selector.startsWith('.')?n.classList.contains(selector.slice(1)):n.id===selector.slice(1))||null;}
  setAttribute(k,v){this.attributes[k]=v;if(k==='hidden')this.hidden=true;}
  addEventListener(k,v){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(v);}
  focus(){}
}
const all=n=>[n,...n.children.flatMap(all)],copy=v=>JSON.parse(JSON.stringify(v));
function setup(){
  const body=new Element('body'),source=new Element('section'),input=new Element('input'),chat=new Element('textarea');source.id='entityTab-reports';chat.id='cacaPertanyaan';source.append(input);body.append(source,chat);
  const events=[],listeners=new Map(),records=new Map(),timers=new Map(),handlers={};let scope='__entity__',identity='account1',next=0,hold=null;
  const document={body,documentElement:{dataset:{skin:'classic'}},getElementById:id=>all(body).find(n=>n.id===id)||null,createElement:t=>new Element(t),createComment:()=>new Element('#comment'),addEventListener(){},dispatchEvent(){}};
  const box={document,TextEncoder,Date,JSON,Promise,Math,innerWidth:1280,innerHeight:900,localStorage:{getItem:()=>null,setItem(){}},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail;}},setTimeout:fn=>{const id=++next;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},dispatchEvent:e=>events.push(e)};
  box.window=box;
  box.UnaKanvas={mount:()=>({destroy(){},setRevision(){}})};
  box.loadEntityTabContent=async()=>{if(hold)await hold;};
  vm.createContext(box);
  for(const name of ['una-kemampuan-data','una-registry','una-mount','una-surfaces-client','una-lembar','caca-workspace'])vm.runInContext(readFileSync(new URL('../public/'+name+'.js',import.meta.url),'utf8'),box);
  const api=async(route,opts={})=>{
    if(route.includes('/workspace'))return {items:[]};
    const id=new URL(route,'https://fixture').pathname.split('/')[4],b=JSON.parse(opts.body||'{}');
    if(opts.method==='POST'){const s={...b,id:'srf_'+(++next),revision:1,scope:{lingkup:'entity'}};records.set(s.id,s);return {surface:copy(s)};}
    if(opts.method==='PATCH'){const s={...records.get(id),...b,revision:b.expectedRevision+1};records.set(id,s);return {surface:copy(s)};}
    return id?{surface:copy(records.get(id))}:{items:copy([...records.values()])};
  };
  const options={api,getIdentity:()=>identity,getScope:()=>scope,scopeQuery:s=>s==='__entity__'?'lingkup=entity':'store='+s,scopeLabel:()=>scope,setPending(){}};
  box.UnaWorkspace.configure(options);
  return {box,body,source,input,chat,records,events,timers,handlers,options,get:id=>document.getElementById(id),hold:p=>{hold=p;},switchScope:()=>{scope='G001';box.UnaWorkspace.scopeChanged();},switchAccount:()=>{identity='account2';box.UnaWorkspace.configure(options);}};
}
test('page reuse shares the original panel and preserves manual inputs and composer',async()=>{
  const h=setup(),a=await h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});h.input.value='edit manual';
  const b=await h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  assert.equal(a.id,b.id);assert.equal(h.records.size,1);assert.equal(all(h.body).filter(n=>n===h.input).length,1);assert.equal(h.input.value,'edit manual');assert.equal(h.get('cacaPertanyaan'),h.chat);
  await h.box.UnaLembar.close();assert.equal(h.input.parentNode,h.source);assert.equal(h.records.size,1);assert.equal(h.box.UnaLembar.active(),null);
  await h.box.UnaLembar.focus(a.id);assert.equal(h.box.UnaLembar.context().pageMounted,true);h.box.UnaWorkspace.reset();assert.equal(h.input.parentNode,h.source);assert.equal(h.timers.size,0);
});
test('late page opening cannot steal focus from a newer canvas or new account',async()=>{
  const h=setup();let release;h.hold(new Promise(r=>release=r));const pending=h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  // Let creation finish and the original loader wait.
  for(let i=0;i<5;i++)await Promise.resolve();
  const canvas=await h.box.UnaLembar.newCanvas();release();assert.equal(await pending,null);assert.equal(h.box.UnaLembar.active().id,canvas.id);
  let finish;h.hold(new Promise(r=>finish=r));const old=h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});for(let i=0;i<5;i++)await Promise.resolve();h.switchAccount();finish();assert.equal(await old,null);assert.equal(h.box.UnaLembar.active(),null);assert.equal(h.input.parentNode,h.source);
});
test('manual page edits block model overwrite while command corrections can supersede pending data',async()=>{
  const h=setup();await h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  h.box.UnaLembar.updatePage('entity:reports',{from:'2026-10-01',to:'2026-10-10'},'command');assert.equal(h.box.UnaLembar.context().dirty,false);
  h.box.UnaLembar.updatePage('entity:reports',{from:'2026-10-01',to:'2026-10-08'});assert.equal(h.box.UnaLembar.context().dirty,true);
  const s=h.box.UnaLembar.active(),r=await h.box.UnaRegistry.execute({actionId:'a1',turnId:'t1',capabilityId:'report.refresh',capabilityVersion:1,params:{},target:{surfaceId:s.id,expectedRevision:s.revision},scopeEpoch:h.box.UnaLembar.context().scopeEpoch,origin:'model'});
  assert.equal(r.code,'REVISION_CONFLICT');await h.box.UnaLembar.save(s.id);assert.equal(h.box.UnaLembar.context().dirty,false);
});
test('an unknown task never receives a successful navigation receipt',async()=>{
  const h=setup();const r=await h.box.UnaRegistry.execute({actionId:'a1',turnId:'t1',capabilityId:'task.open',capabilityVersion:1,params:{taskId:'wk_missing'},target:null,scopeEpoch:h.box.UnaLembar.context().scopeEpoch,origin:'model'});
  assert.equal(r.status,'failed');assert.equal(h.box.UnaLembar.active(),null);
});

test('returning to a saved page rechecks role restrictions and mount ownership',async()=>{
  const h=setup(),s=await h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  h.box.UnaMount.claim('entity:reports',h.source,'menu');assert.equal(h.box.UnaLembar.context().pageMounted,false);
  await h.box.UnaLembar.focus(s.id);assert.equal(h.box.UnaLembar.context().pageMounted,true);
  h.box.UnaWorkspace.configure({...h.options,getRole:()=> 'CASHIER'});
  await assert.rejects(h.box.UnaLembar.focus(s.id),/Halaman tidak tersedia/);h.box.UnaWorkspace.reset();
});

test('manual filters changed during page loading are retained and default filters persist on first open',async()=>{
  const h=setup();let from='2026-10-01',to='2026-10-10',restored=0;
  h.box.UnaPageAdapters={'entity:reports':{setFilters:f=>{restored++;from=f.from;to=f.to;},refresh:async()=>({ok:true}),readState:()=>({from,to,stores:['G001'],status:'ready'})}};
  const first=await h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  assert.equal(first.revision,2);assert.equal(h.records.get(first.id).content.filters.to,'2026-10-10');
  let release;h.hold(new Promise(r=>release=r));const pending=h.box.UnaLembar.openPage({halaman:'entity',tab:'reports'});
  for(let i=0;i<8;i++)await Promise.resolve();
  to='2026-10-08';h.box.UnaLembar.updatePage('entity:reports',{from,to,stores:['G001']});
  release();const result=await pending;
  assert.equal(restored,0);assert.equal(to,'2026-10-08');assert.equal(h.records.get(first.id).content.filters.to,'2026-10-08');assert.equal(result.revision,h.box.UnaLembar.context().surface.revision);h.box.UnaWorkspace.reset();
});
