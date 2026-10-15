import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/una-surfaces-client.js',import.meta.url),'utf8');
function harness(api){const window={},timers=new Map();let sequence=0,identity='account',scope='__entity__';vm.runInNewContext(code,{window,setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)});const changes=[];const client=window.UnaSurfacesClient.create({getIdentity:()=>identity,getScope:()=>scope,scopeQuery:()=> 'lingkup=entity',api,onChange:e=>changes.push(e.status)});return{client,timers,changes,changeScope:()=>{scope='G001';}};}
const s={id:'srf_test',kind:'canvas',title:'Draft',revision:1,content:{objects:[]}};
test('edits debounce without polling and an in-flight save never overwrites newer local edits',async()=>{
  let release;const h=harness(async(path,settings)=>{if(settings.method==='POST')return{surface:s};return new Promise(resolve=>release=()=>resolve({surface:{...s,title:'first',revision:2}}));});
  await h.client.add(s);h.client.edit(s.id,{title:'first'});h.client.edit(s.id,{title:'second'});assert.equal(h.timers.size,1);
  const saving=h.client.save(s.id);h.client.edit(s.id,{title:'third'});release();await saving;
  const e=h.client.get(s.id);assert.equal(e.surface.title,'third');assert.equal(e.surface.revision,2);assert.equal(e.dirty,true);assert.equal(h.timers.size,1);h.client.reset();assert.equal(h.timers.size,0);
});
test('409 preserves local content and explicitly offers server load or a new canvas',async()=>{
  let requests=0;const latest={...s,title:'remote',revision:2};const h=harness(async(path,options)=>{requests++;if(options.method==='POST')return{surface:requests===1?s:{...s,id:'copy'}};if(options.method==='PATCH')throw {status:409,payload:{surface:latest}};return {surface:latest};});
  await h.client.add(s);h.client.edit(s.id,{title:'local'});assert.equal(await h.client.save(s.id),false);assert.equal(h.client.get(s.id).surface.title,'local');assert.equal(h.client.get(s.id).conflict.title,'remote');
  assert.equal((await h.client.resolve(s.id,'copy')).surface.id,'copy');assert.equal(h.client.get(s.id).surface.title,'local');
  await h.client.resolve(s.id,'server');assert.equal(h.client.get(s.id).surface.title,'remote');assert.equal(h.client.get(s.id).dirty,false);h.client.reset();
});
test('network failure preserves edits; late saves after scope switch cannot repopulate state',async()=>{
  let rejectSave;const h=harness(async(path,options)=>{if(options.method==='POST')return{surface:s};return new Promise((resolve,reject)=>rejectSave=reject);});
  await h.client.add(s);h.client.edit(s.id,{title:'local'});const pending=h.client.save(s.id);rejectSave(new Error('offline'));assert.equal(await pending,false);assert.equal(h.client.get(s.id).status,'Belum tersimpan');
  const stale=h.client.save(s.id);h.changeScope();h.client.reset();rejectSave(new Error('late'));await stale;assert.equal(h.client.values().length,0);
});

test('server conflict resolution preserves edits made while the read is pending',async()=>{
  let release;const latest={...s,title:'remote',revision:2};
  const h=harness(async(path,options={})=>{if(options.method==='POST')return{surface:s};if(options.method==='PATCH')throw{status:409,payload:{surface:latest}};return new Promise(r=>release=()=>r({surface:latest}));});
  await h.client.add(s);h.client.edit(s.id,{title:'before'});await h.client.save(s.id);
  const pending=h.client.resolve(s.id,'server');h.client.edit(s.id,{title:'new edit'});release();
  await assert.rejects(pending,/Edit baru/);assert.equal(h.client.get(s.id).surface.title,'new edit');assert.equal(h.client.get(s.id).dirty,true);h.client.reset();
});
test('canvas metadata detects a newer device revision and reopening loads it without overwriting dirty content',async()=>{
  const latest={...s,title:'remote',revision:2,content:{objects:[{id:'remote'}]}};
  const h=harness(async(path,options={})=> options.method==='POST'?{surface:s}:path.includes('/srf_test?')?{surface:latest}:{items:[{...latest,content:undefined}]});
  await h.client.add(s);await h.client.list();assert.equal(h.client.get(s.id).needsReload,true);assert.equal(h.client.get(s.id).surface.revision,1);
  await h.client.open(s.id);assert.equal(h.client.get(s.id).surface.title,'remote');assert.equal(h.client.get(s.id).status,'Tersimpan');
  h.client.edit(s.id,{title:'local'});latest.revision=3;await h.client.open(s.id);assert.equal(h.client.get(s.id).surface.title,'local');assert.equal(h.client.get(s.id).conflict.revision,3);h.client.reset();
});
