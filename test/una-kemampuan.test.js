import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';
import { KEMAMPUAN, validasiPerintah, daftarKemampuanUntukModel } from '../src/una-kemampuan.js';
import { validateSchema, dateValid } from '../src/una-kemampuan-validasi.js';
import { bukaLayarDariPesan } from '../src/caca-buka-layar.js';
const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const fixture = JSON.parse(read('./fixtures/una-live/keluaran-model-palsu.json'));
const defaultContext = () => ({...fixture.context,pageMounted:true,surface:{id:fixture.context.activeSurfaceId,kind:'page',revision:2,content:{halaman:'entity',tab:'reports'}}});
const action = (extra={}) => ({actionId:'act_1',turnId:'turn_1',capabilityId:'page.open',capabilityVersion:1,params:{halaman:'entity',tab:'reports'},target:{surfaceId:fixture.context.activeSurfaceId,expectedRevision:2},scopeEpoch:7,origin:'model',...extra});
function browser(context=defaultContext()) {
  let c = context;
  const events = [];
  const box = {TextEncoder,console,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};
  box.window=box;
  vm.createContext(box);
  vm.runInContext(read('../public/una-kemampuan-data.js'),box);
  vm.runInContext(read('../public/una-registry.js'),box);
  const registry=box.UnaRegistry.create({getContext:()=>c});
  return {box,registry,events,setContext:value=>{c=value;}};
}
test('runtime descriptors match the agreed U0 fixture',()=>{
  assert.deepEqual(KEMAMPUAN,JSON.parse(read('./fixtures/una-live/kemampuan.json')).capabilities);
  assert.ok(Object.isFrozen(KEMAMPUAN[0].params.properties));
});
test('all bad model fixtures are rejected identically on server and browser',async()=>{
  for (const sc of fixture.cases) {
    const context={...defaultContext(),...sc.context};
    let output=JSON.parse(JSON.stringify(sc.output));
    if (output.params?.operations === '__51_ops__') output.params.operations=Array.from({length:51},()=>({op:'add',object:{type:'text',text:'x'}}));
    if (output.params?.tab === '__41_chars__') output.params.tab='a'.repeat(41);
    const command=action(output);
    const server=validasiPerintah(command,context);
    assert.equal(server.ok,false,sc.name);
    assert.equal(server.receipt.status,sc.expect.status,sc.name);
    assert.equal(server.receipt.code,sc.expect.code,sc.name);
    const h=browser(context);
    const r=await h.registry.execute(command);
    assert.equal(r.status,sc.expect.status,sc.name);
    assert.equal(r.code,sc.expect.code,sc.name);
  }
});
test('scope checks precede capability and role checks; revisions precede execution',()=>{
  assert.equal(validasiPerintah(action({scopeEpoch:6,capabilityId:'evil'}),defaultContext()).receipt.code,'SCOPE_CHANGED');
  assert.equal(validasiPerintah(action({capabilityId:'report.refresh',params:{},target:{surfaceId:fixture.context.activeSurfaceId,expectedRevision:1}}),defaultContext()).receipt.code,'REVISION_CONFLICT');
  assert.equal(validasiPerintah(action({capabilityId:'report.refresh',params:{}}),{...defaultContext(),lingkup:'gerai'}).receipt.code,'SCOPE_DENIED');
});
test('schema rejects unsupported constraints and impossible calendar dates',()=>{
  assert.throws(()=>validateSchema({type:'string',maxLength:10,minLength:1}));
  assert.throws(()=>validateSchema({type:'object',properties:{},required:[],additionalProperties:true}));
  assert.equal(dateValid('2024-02-29'),true);
  for (const date of ['2026-02-29','2026-02-30','2026-13-01','2026-1-01','garbage']) assert.equal(dateValid(date),false,date);
  const reversed=validasiPerintah(action({capabilityId:'report.set_filters',params:{from:'2026-10-10',to:'2026-10-01'}}),defaultContext());
  assert.equal(reversed.receipt.status,'needs_clarification');
});
test('catalogue and navigation retain role/skin restrictions without invoking a model',()=>{
  assert.equal(daftarKemampuanUntukModel({...defaultContext(),role:'ADMIN',lingkup:'gerai'}).some(c=>c.id==='report.refresh'),false);
  const result=bukaLayarDariPesan('buka laporan usaha',{peran:'Entity Admin',lingkup:'entity',skin:'classic',surfaceContext:{turnId:'turn_12',scopeEpoch:12}});
  assert.equal(result.uiActions.length,1);
  assert.equal(result.uiActions[0].capabilityId,'page.open');
  assert.equal(result.uiActions[0].scopeEpoch,12);
  assert.equal(result.uiActions[0].turnId,'turn_12');
  assert.equal(result.draft,undefined);
  assert.equal(bukaLayarDariPesan('buka laporan usaha',{peran:'CASHIER',lingkup:'entity',skin:'classic'}).navigasi,undefined);
});
test('registry deduplicates simultaneous and completed commands',async()=>{
  const h=browser(); let count=0,release;
  const wait=new Promise(r=>{release=r;});
  h.registry.register('page.open',{execute:async()=>{count++;await wait;return {ok:true,proof:{kind:'state_read'},summary:{tab:'reports'}};},verify:()=>true});
  const first=h.registry.execute(action()), second=h.registry.execute(action());
  assert.equal(count,1);release();
  assert.equal((await first).status,'ok');assert.equal((await second).replayed,true);
  assert.equal((await h.registry.execute(action())).replayed,true);
  assert.equal(count,1);
});
test('a rejected action id is also deduplicated and cannot be changed into a different action',async()=>{
  const h=browser();let executions=0;h.registry.register('page.open',{execute:()=>{executions++;return {ok:true};}});
  const rejected=await h.registry.execute(action({params:{halaman:'entity',tab:'bad'}}));assert.equal(rejected.code,'FORBIDDEN_TARGET');
  const replay=await h.registry.execute(action());assert.equal(replay.replayed,true);assert.equal(replay.code,'FORBIDDEN_TARGET');assert.equal(executions,0);
});
test('newer command supersedes an unfinished command for the same target',async()=>{
  const h=browser(); let release;
  h.registry.register('report.set_filters',{execute:async params=>{
    if (params.to==='2026-10-10') await new Promise(r=>{release=r;});
    return {ok:true,proof:{kind:'data_loaded'},summary:{to:params.to}};
  },verify:()=>true});
  const base=action({capabilityId:'report.set_filters',params:{from:'2026-10-01',to:'2026-10-10'},target:{surfaceId:fixture.context.activeSurfaceId,expectedRevision:2}});
  const old=h.registry.execute(base);
  const newer=await h.registry.execute({...base,actionId:'act_2',params:{from:'2026-10-01',to:'2026-10-08'}});
  release();
  assert.equal(newer.status,'ok');
  assert.equal((await old).status,'superseded');
});
test('scope switch and reset invalidate both successful and failed late handlers',async()=>{
  for (const fail of [false,true]) {
    const h=browser();let release;
    h.registry.register('page.open',{execute:async()=>{await new Promise(r=>{release=r;});if(fail)throw new Error('secret');return {ok:true,proof:{kind:'state_read'}};},verify:()=>true});
    const pending=h.registry.execute(action());
    h.setContext({...defaultContext(),scopeEpoch:8});h.registry.reset();release();
    const receipt=await pending;
    assert.equal(receipt.code,'SCOPE_CHANGED');
    assert.equal(h.events.length,0,'late handler must not publish into the new scope');
  }
});
test('handler must prove a successful result and raw errors are not exposed',async()=>{
  const h=browser();
  h.registry.register('report.refresh',{execute:async()=>({ok:true,proof:{kind:'data_loaded'}}),verify:()=>false});
  assert.equal((await h.registry.execute(action({capabilityId:'report.refresh',params:{}}))).code,'NOT_VERIFIED');
  h.registry.register('page.open',{execute:()=>{throw new Error('password=do-not-expose');}});
  const failed=await h.registry.execute(action({actionId:'act_2'}));
  assert.equal(failed.code,'DATA_FAILED');assert.doesNotMatch(failed.message,/password|expose/);
  assert.throws(()=>h.registry.register('page.click',{execute(){}}));
});

test('report actions cannot omit the target revision to bypass a manual edit',()=>{
  const result=validasiPerintah(action({capabilityId:'report.refresh',params:{},target:null}),defaultContext());
  assert.equal(result.receipt.code,'PRECONDITION_FAILED');
});
test('server and browser catalogues follow the active page or canvas',()=>{
  for(const context of [defaultContext(),{...defaultContext(),surface:null},{...defaultContext(),surface:{id:'srf_canvas',kind:'canvas',revision:1}}]){
    const server=daftarKemampuanUntukModel(context).map(d=>d.id);
    const client=Array.from(browser(context).registry.catalogue(),d=>d.id);
    assert.deepEqual(client,server);
    assert.equal(server.includes('report.refresh'),context.surface?.kind==='page');
    assert.equal(server.includes('canvas.apply_patch'),context.surface?.kind==='canvas');
    assert.ok(server.includes('page.open'));assert.ok(server.includes('canvas.create'));
  }
});

test('explicit read cancellation invalidates pending render guards without cancelling artifact work',async()=>{
  const h=browser();let releaseRead,releaseArtifact,readExec,artifactExec;
  h.registry.register('report.refresh',{execute:async(p,e)=>{readExec=e;await new Promise(r=>releaseRead=r);return{ok:true,proof:{kind:'data_loaded'}};},verify:()=>true});
  h.registry.register('canvas.create',{execute:async(p,e)=>{artifactExec=e;await new Promise(r=>releaseArtifact=r);return{ok:true,proof:{kind:'artifact_saved'}};},verify:()=>true});
  const read=h.registry.execute(action({capabilityId:'report.refresh',params:{}}));
  assert.equal(readExec.isCurrent(),true);assert.equal(h.registry.cancelReads(),1);assert.equal(readExec.isCurrent(),false);
  h.setContext({...defaultContext(),activeSurfaceId:null,surface:null});
  const artifact=h.registry.execute(action({actionId:'act_artifact',capabilityId:'canvas.create',params:{},target:null}));
  assert.equal(h.registry.cancelReads(),0);assert.equal(artifactExec.isCurrent(),true);
  releaseRead();releaseArtifact();assert.equal((await read).status,'cancelled');assert.equal((await artifact).status,'ok');assert.equal(h.registry.cancelReads(),0);
});
