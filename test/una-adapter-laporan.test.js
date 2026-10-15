import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dateValid} from '../src/una-kemampuan-validasi.js';
test('report adapter changes only valid filters, proves loader state, and excludes business totals from receipt',async()=>{
  const window={UnaKemampuanValidasi:{dateValid}};vm.runInNewContext(readFileSync(new URL('../public/una-adapter-laporan.js',import.meta.url),'utf8'),{window});
  let state={from:'2026-10-01',to:'2026-10-10',stores:['G001'],status:'ready',requestKey:1,result:{totals:123456}};const handlers={};
  const a=window.UnaReportAdapter.create({readState:()=>({...state}),storeCodes:()=>['G001'],invalidate:()=>{state.status='idle';},writeFilters:p=>Object.assign(state,p),refresh:async()=>{state.status='ready';state.requestKey++;return{ok:true,requestKey:state.requestKey};},surface:()=>({id:'srf_report',revision:2})});a.bind({register:(id,h)=>handlers[id]=h});
  assert.throws(()=>a.setFilters({from:'2026-02-30',to:'2026-03-01'}));assert.throws(()=>a.setFilters({from:'2026-10-01',to:'2026-10-08',stores:['FOREIGN']}));
  const result=await handlers['report.set_filters'].execute({from:'2026-10-01',to:'2026-10-08'},{});assert.equal(result.ok,true);assert.equal(result.proof.filters.to,'2026-10-08');assert.equal(handlers['report.set_filters'].verify(result),true);assert.equal(result.summary.totals,undefined);
  state.to='2026-10-07';assert.equal(handlers['report.set_filters'].verify(result),false);
});
test('canonical report loader rejects out-of-order results, manual corrections, scope changes and errors',async()=>{
  const source=readFileSync(new URL('../public/entity-admin.js',import.meta.url),'utf8');const loader=source.slice(source.indexOf('let entityReportRequestKey ='),source.indexOf('\nasync function saveEntityEmployee'));
  const nodes=Object.fromEntries(['entityReportFrom','entityReportTo','entityReportStatus','entityReportChart','entityReportStoreTable','entityReportTableWrap'].map(id=>[id,{value:id==='entityReportFrom'?'2026-10-01':'2026-10-10',replaceChildren(){}}]));
  const requests=[],rendered=[],events=[];const state={token:'one',entityAdmin:{entityId:'E'}};
  const ctx=vm.createContext({window:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(name,options){this.detail=options.detail;}},entityAdminEl:id=>nodes[id],selectedReportStoreCodes:()=>['G001'],entityAdminState:state,anyEntityStoreCode:()=> 'G001',entityAdminApi:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),renderEntityReportTable:p=>rendered.push(p),renderEntityReportMetricButtons(){},renderEntityReportChart(){}});vm.runInContext(loader,ctx);
  const first=ctx.runEntityReport();nodes.entityReportTo.value='2026-10-08';ctx.invalidateEntityReport();const second=ctx.runEntityReport();requests[1].resolve({totals:'new'});assert.equal((await second).ok,true);requests[0].resolve({totals:'old'});assert.equal((await first).code,'SUPERSEDED');assert.equal(rendered.length,1);assert.equal(rendered[0].totals,'new');
  const manual=ctx.runEntityReport();nodes.entityReportTo.value='2026-10-07';requests[2].resolve({totals:'old'});assert.equal((await manual).ok,false);
  const scope=ctx.runEntityReport();state.token='two';requests[3].resolve({});assert.equal((await scope).code,'SUPERSEDED');
  const failed=ctx.runEntityReport();requests[4].reject(new Error('report failed'));assert.equal((await failed).code,'DATA_FAILED');assert.equal(ctx.readEntityReportState().status,'error');assert.equal(rendered.length,1);
});
