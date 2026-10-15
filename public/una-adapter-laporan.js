/* Semantic report adapter. Uses the application's sole report loader. */
(() => {
  'use strict';
  const equal=(a,b)=>JSON.stringify([...(a||[])].sort())===JSON.stringify([...(b||[])].sort());
  function create(options){
    const filters=state=>({from:state.from,to:state.to,stores:state.stores});
    function setFilters(params){
      const valid=window.UnaKemampuanValidasi.dateValid;
      if(!valid(params.from)||!valid(params.to)||params.from>params.to)throw new Error('Periksa tanggal laporan.');
      if(params.stores&&(!params.stores.length||params.stores.some(c=>!options.storeCodes().includes(c))))throw new Error('Pilih gerai yang tersedia.');
      options.writeFilters(params);options.invalidate();
      options.onFilters?.(filters(options.readState()));
      return options.readState();
    }
    async function execute(params,execution,change){
      if(execution.isCurrent?.()===false)return {ok:false,status:'superseded',code:'SUPERSEDED'};
      if(change)setFilters(params);
      const expected=filters(options.readState());
      if(change&&params.reload===false)return {ok:false,code:'NOT_VERIFIED',message:'Filter diubah; laporan belum dimuat.'};
      const loaded=await options.refresh({isCurrent:execution.isCurrent});
      if(!loaded.ok)return {...loaded,status:loaded.code==='SUPERSEDED'?'superseded':'failed'};
      const state=options.readState();
      if(state.status!=='ready'||state.requestKey!==loaded.requestKey||state.from!==expected.from||state.to!==expected.to||!equal(state.stores,expected.stores))return {ok:false,code:'NOT_VERIFIED'};
      await options.save?.();
      const surface=options.surface?.();
      return {ok:true,surfaceId:surface?.id,resultRevision:surface?.revision,
        summary:{from:state.from,to:state.to,storeCount:state.stores.length},
        proof:{kind:'data_loaded',filters:expected,requestKey:loaded.requestKey,at:new Date().toISOString()}};
    }
    function bind(registry){
      const verify=r=>{const s=options.readState();return s.status==='ready'&&s.requestKey===r.proof.requestKey&&s.from===r.proof.filters.from&&s.to===r.proof.filters.to&&equal(s.stores,r.proof.filters.stores);};
      registry.register('report.set_filters',{execute:(p,e)=>execute(p,e,true),verify});
      registry.register('report.refresh',{execute:(p,e)=>execute(p,e,false),verify});
    }
    return {readState:options.readState,setFilters,refresh:options.refresh,bind};
  }
  window.UnaReportAdapter={create};
  if(typeof readEntityReportState!=='function')return;
  const controls=()=>[...document.querySelectorAll('#entityReportStoreChecklist input[type="checkbox"]')];
  const adapter=create({readState:readEntityReportState,refresh:runEntityReport,invalidate:invalidateEntityReport,
    storeCodes:()=>controls().map(n=>n.value),surface:()=>window.UnaLembar?.surfaceForPanel('entity:reports'),
    onFilters:filters=>window.UnaLembar?.updatePage('entity:reports',filters,'command'),save:()=>{const s=window.UnaLembar?.surfaceForPanel('entity:reports');return s?window.UnaLembar.save(s.id):null;},
    writeFilters:p=>{document.getElementById('entityReportFrom').value=p.from;document.getElementById('entityReportTo').value=p.to;if(p.stores)for(const n of controls())n.checked=p.stores.includes(n.value);}});
  window.UnaPageAdapters=window.UnaPageAdapters||{};window.UnaPageAdapters['entity:reports']=adapter;
  adapter.bind(window.UnaRegistry);
  for(const id of ['entityReportFrom','entityReportTo','entityReportStoreChecklist'])document.getElementById(id)?.addEventListener('change',()=>{
    invalidateEntityReport();const state=readEntityReportState();window.UnaLembar?.updatePage('entity:reports',{from:state.from,to:state.to,stores:state.stores});
  });
  window.addEventListener('caca-scope-change',invalidateEntityReport);
})();
