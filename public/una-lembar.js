/* Page/canvas surfaces share the existing task Workspace and original app nodes. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),clone=v=>JSON.parse(JSON.stringify(v));
  const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,action)=>{const n=make('button',text,'secondary-btn');n.type='button';n.addEventListener('click',action);return n;};
  const surfaces=new Map(),hosts=new Map(),editors=new Map(),registered=new WeakSet(),manualPageEdits=new Set();
  let adapter=null,client=null,active=null,epoch=0,identity='',scope='',listing=0,focusing=0;
  const emit=(surface,action)=>window.dispatchEvent(new CustomEvent('una-live:surface',{detail:{surfaceId:surface?.id||null,kind:surface?.kind||'task',action,revision:surface?.revision||null}}));
  const valid=marker=>marker===epoch&&adapter?.getIdentity()===identity&&adapter?.getScope()===scope;
  const fail=message=>{throw new Error(message);};
  function storageKey(){let hash=0;for(const c of identity)hash=(Math.imul(hash,31)+c.charCodeAt(0))|0;return 'lekerUnaLembarAktif:'+hash+':'+scope;}
  function saveFocus(){try{localStorage.setItem(storageKey(),active||'task');}catch{}}
  function ensure(){
    const panel=$('cacaWorkspace');if(!panel||$('unaSurfaceTabs'))return;
    const nav=make('nav',null,'una-surface-tabs');nav.id='unaSurfaceTabs';nav.setAttribute('aria-label','Lembar Workspace');
    const view=make('div',null,'una-surface-view hidden');view.id='unaSurfaceView';
    panel.querySelector('.caca-workspace-grid').before(nav);panel.append(view);
    const head=panel.querySelector('.caca-workspace-head');
    head.append(button('Lembar gambar baru',()=>{void newCanvas().catch(showError);}));
    head.append(button('Tutup tampilan lembar',()=>{void close().catch(showError);}));
    renderTabs();
  }
  function showError(error){const status=$('cacaWorkspaceStatus');if(status)status.textContent=error.message||'Lembar belum dapat dibuka.';}
  function surfaceForPanel(panelKey){return [...surfaces.values()].find(s=>s.kind==='page'&&s.content&&s.content.halaman+':'+s.content.tab===panelKey)||null;}
  function entryChanged(entry){
    const s=entry.surface;surfaces.set(s.id,s);
    if(!entry.dirty)manualPageEdits.delete(s.id);
    const editor=editors.get(s.id);if(editor&&entry.status==='Tersimpan')editor.setRevision(s.revision);
    renderTabs();renderStatus();
    if(entry.status==='Tersimpan')emit(s,'saved');else if(entry.conflict)emit(s,'conflict');
  }
  function configure(value){
    const nextIdentity=value.getIdentity(),nextScope=value.getScope();
    if(adapter&&identity===nextIdentity&&scope===nextScope){adapter=value;ensure();return;}
    reset();adapter=value;identity=nextIdentity;scope=nextScope;
    if(!identity||!scope)return;
    client=window.UnaSurfacesClient.create({...value,onChange:entryChanged});
    ensure();window.UnaRegistry?.configure(context);bindRegistry(window.UnaRegistry);
  }
  function context(){
    const task=active?.startsWith('task:')?window.UnaWorkspace.taskState(active.slice(5)):null;
    const surface=surfaces.get(active)||(task?{id:active,kind:'task',revision:task.revision}:null);
    return {scopeEpoch:epoch,role:adapter?.getRole?.()||'ENTITY_ADMIN',lingkup:scope==='__entity__'?'entity':'gerai',skin:document.documentElement?.dataset.skin||'classic',
      activeSurfaceId:active,surface,pageMounted:surface?.kind==='page'&&hosts.has(active)&&window.UnaMount?.owner(surface.content.halaman+':'+surface.content.tab)==='workspace',dirty:surface?.kind==='page'?manualPageEdits.has(active):!!client?.get(active)?.dirty};
  }
  function renderTabs(){
    const nav=$('unaSurfaceTabs');if(!nav)return;nav.replaceChildren();
    const task=button('Tugas',()=>showTasks());task.setAttribute('aria-current',String(!active||active.startsWith('task:')));nav.append(task);
    for(const s of surfaces.values()){
      const pick=button(s.title,()=>{void focus(s.id).catch(showError);});pick.setAttribute('aria-current',String(active===s.id));
      const cell=make('span',null,'una-surface-tab');cell.append(pick);nav.append(cell);
    }
  }
  function renderStatus(){
    const host=$('unaSurfaceSaveStatus');if(!host)return;host.replaceChildren();const e=client?.get(active);if(!e)return;
    host.append(make('span',e.status));
    if(e.conflict){host.append(button('Muat versi server',async()=>{
      const id=active,marker=epoch;
      try{const entry=await client.resolve(id,'server');if(!valid(marker))return;const s=entry.surface;editors.get(id)?.replace(s.content,s.revision);if(active===id&&s.kind==='page'){const a=window.UnaPageAdapters?.[s.content.halaman+':'+s.content.tab];a?.setFilters(s.content.filters);await a?.refresh();}renderStatus();}catch(error){if(valid(marker))showError(error);}
    }));
      if(e.surface.kind==='canvas')host.append(button('Simpan sebagai lembar baru',async()=>{const id=active,marker=epoch;try{const copy=await client.resolve(id,'copy');if(valid(marker)&&active===id)await focus(copy.surface.id);}catch(error){if(valid(marker))showError(error);}}));
      else host.append(button('Ekspor filter lokal',()=>exportFilters(e.surface)));
    }else if(e.dirty)host.append(button('Simpan sekarang',()=>{void client.save(active);}));
  }
  function exportFilters(s){const blob=new Blob([JSON.stringify(s.content,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download='filter-lembar.json';a.click();URL.revokeObjectURL(url);}
  function showTasks(id=null){
    focusing++;
    active=id?'task:'+id:null;ensure();$('unaSurfaceView')?.classList.add('hidden');$('cacaWorkspace')?.querySelector('.caca-workspace-grid')?.classList.remove('hidden');
    for(const [key,host] of hosts)host.hidden=true;
    if($('unaSurfaceSaveStatus'))$('unaSurfaceSaveStatus').hidden=true;
    if(id)adapter?.selectTask?.(id);saveFocus();renderTabs();emit({id:active,kind:'task'},'focused');
  }
  async function refresh(){
    if(!client||!valid(epoch))return;const marker=epoch,sequence=++listing;
    try{const list=await client.list();if(!valid(marker)||sequence!==listing)return;for(const s of list)if(!surfaces.has(s.id))surfaces.set(s.id,s);renderTabs();}catch(error){if(valid(marker))showError(error);}
  }
  async function openPage(params,execution={}){
    if(!adapter||!valid(epoch))fail('Buka chat dan pilih lingkup dulu.');
    const c=context();const menu=window.UNA_KEMAMPUAN.menus.find(m=>m.skin===c.skin&&m.halaman===params.halaman&&m.tab===params.tab);
    if(!menu||!['OWNER','ENTITY_ADMIN'].includes(c.role))fail('Halaman tidak tersedia.');
    if(params.halaman!=='entity'||!$('entityTab-'+params.tab))fail('Buka halaman Entity untuk memakai lembar halaman ini.');
    if(c.lingkup!=='entity')fail('Pilih lingkup Entity pada chat untuk membuka halaman ini.');
    const marker=epoch;
    let s=surfaceForPanel(params.halaman+':'+params.tab);
    if(!s){const e=await client.add({kind:'page',title:menu.label,content:{halaman:params.halaman,tab:params.tab,filters:{}}});s=e.surface;}
    if(!valid(marker)||execution.isCurrent?.()===false)fail('Permintaan halaman sudah berubah.');
    return focus(s.id,{load:true,menu:params.display==='menu',isCurrent:execution.isCurrent});
  }
  async function focus(id,options={}){
    if(id.startsWith('task:'))return openTask(id.slice(5),options);
    let s=surfaces.get(id);if(!s)fail('Lembar tidak ditemukan.');
    const marker=epoch,sequence=++focusing;
    const current=()=>valid(marker)&&sequence===focusing&&options.isCurrent?.()!==false;
    s=(await client.open(id)).surface;if(!current())return null;
    if(s.kind==='page'){
      const c=context(),p=s.content;
      const menu=window.UNA_KEMAMPUAN.menus.find(m=>m.skin===c.skin&&m.halaman===p.halaman&&m.tab===p.tab);
      if(!menu||!['OWNER','ENTITY_ADMIN'].includes(c.role)||c.lingkup!=='entity'||p.halaman!=='entity'||!$('entityTab-'+p.tab))fail('Halaman tidak tersedia untuk akses dan tampilan ini.');
    }
    if(options.isCurrent?.()===false)return null;
    ensure();window.UnaWorkspace.show();active=s.id;saveFocus();
    $('cacaWorkspace').querySelector('.caca-workspace-grid').classList.add('hidden');$('unaSurfaceView').classList.remove('hidden');
    let host=hosts.get(id);
    if(!host){host=make('section',null,'una-surface-content');hosts.set(id,host);$('unaSurfaceView').append(host);}
    for(const [key,node] of hosts)node.hidden=key!==id;
    if(s.kind==='page'){
      const key=s.content.halaman+':'+s.content.tab;
      if(options.menu){window.switchEntityTab?.(s.content.tab);window.UnaMount.claim(key,$('entityTab-'+s.content.tab),'menu');}
      else window.UnaMount.claim(key,host,'workspace');
      if(options.load||!host.dataset.loaded){
        const serial=client.get(id)?.serial;
        await window.loadEntityTabContent(s.content.tab,{autoReport:false});
        if(!current())return null;
        const pageAdapter=window.UnaPageAdapters?.[key];
        if(Object.keys(s.content.filters).length&&pageAdapter&&client.get(id)?.serial===serial)pageAdapter.setFilters(s.content.filters);
        if(pageAdapter){
          await pageAdapter.refresh();
          if(!current())return null;
          const state=pageAdapter.readState();
          if(state.status==='ready'){
            window.UnaLembar.updatePage(key,{from:state.from,to:state.to,stores:state.stores},'command');
            await client.save(id);
          }
        }
        host.dataset.loaded='true';
      }
    }else if(s.kind==='canvas'&&editors.has(id)){if(!client.get(id).dirty&&JSON.stringify(editors.get(id).model.content())!==JSON.stringify(s.content))editors.get(id).replace(s.content,s.revision);
    }else if(s.kind==='canvas'&&!editors.has(id)){
      if(!window.UnaKanvas)fail('Editor gambar belum dimuat.');
      const editor=window.UnaKanvas.mount(host,{surface:s,onChange:content=>client.edit(id,{content})});editors.set(id,editor);
    }
    if(!current())return null;
    let status=$('unaSurfaceSaveStatus');if(!status){status=make('div',null,'una-surface-save');status.id='unaSurfaceSaveStatus';$('unaSurfaceView').before(status);}
    status.hidden=false;renderTabs();renderStatus();const latest=surfaces.get(id)||s;emit(latest,'focused');return latest;
  }
  async function newCanvas(params={},execution={}){
    if(!client)fail('Buka chat dan pilih lingkup dulu.');
    const marker=epoch,e=await client.add({kind:'canvas',title:params.title||'Lembar gambar',content:{width:1600,height:1000,background:params.background||'white',objects:[]}});
    if(!valid(marker)||execution.isCurrent?.()===false)return null;emit(e.surface,'opened');return focus(e.surface.id,{isCurrent:execution.isCurrent});
  }
  async function close(id=active){
    const s=surfaces.get(id),marker=epoch,sequence=focusing;if(!s)return;await client.save(id); // Keep the record and unsaved edits in memory.
    if(!valid(marker)||sequence!==focusing)return;
    if(s.kind==='page')window.UnaMount.detach(s.content.halaman+':'+s.content.tab,hosts.get(id));
    hosts.get(id)?.setAttribute('hidden','');showTasks();emit(s,'closed');
  }
  async function openTask(id,execution={}){
    const marker=epoch;await window.UnaWorkspace.refresh();if(!valid(marker)||execution.isCurrent?.()===false)return null;
    const task=window.UnaWorkspace.taskState(id);if(!task)fail('Tugas tidak ditemukan.');
    window.UnaWorkspace.show();showTasks(id);return {id:'task:'+id,kind:'task',revision:task.revision};
  }
  function result(s){return {ok:!!s,surfaceId:s?.id||null,resultRevision:s?.revision||null,summary:{kind:s?.kind||'task'},proof:{kind:'state_read',at:new Date().toISOString()}};}
  function bindRegistry(registry){
    if(!registry||registered.has(registry))return;registered.add(registry);
    const verify=(r)=>r.ok===true&&r.surfaceId===active&&r.resultRevision===context().surface?.revision;
    registry.register('page.open',{execute:async(p,exec)=>result(await openPage(p,exec)),verify});
    registry.register('surface.focus',{execute:async(p,e)=>result(await focus(p.surfaceId,{isCurrent:e.isCurrent})),verify});
    registry.register('surface.close',{execute:async()=>{await close();return {ok:true};}});
    registry.register('task.open',{execute:async(p,e)=>result(await openTask(p.taskId,e)),verify});
    registry.register('page.read_state',{execute:()=>{const s=surfaces.get(active),state=window.UnaPageAdapters?.[s?.content.halaman+':'+s?.content.tab]?.readState();return {...result(s),summary:state?{from:state.from,to:state.to,stores:state.stores,status:state.status}: {page:s?.content?.tab}};},verify});
  }
  function reset(){
    epoch++;listing++;focusing++;client?.reset();client=null;window.UnaRegistry?.reset();
    for(const s of surfaces.values())if(s.kind==='page')window.UnaMount?.detach(s.content.halaman+':'+s.content.tab,hosts.get(s.id));
    for(const e of editors.values())e.destroy();editors.clear();for(const host of hosts.values())host.remove();hosts.clear();surfaces.clear();manualPageEdits.clear();active=null;identity='';scope='';adapter=null;renderTabs();
    $('unaSurfaceSaveStatus')?.remove();$('unaSurfaceView')?.classList.add('hidden');$('cacaWorkspace')?.querySelector('.caca-workspace-grid')?.classList.remove('hidden');
  }
  window.UnaLembar={configure,context,openPage,focus,close,newCanvas,refresh,reset,showTasks,bindRegistry,surfaceForPanel,
    client:()=>client,editor:id=>editors.get(id),active:()=>surfaces.get(active)||null,
    updatePage:(key,filters,source='manual')=>{const s=surfaceForPanel(key);if(s&&JSON.stringify(s.content.filters)!==JSON.stringify(filters)){if(source==='manual')manualPageEdits.add(s.id);client.edit(s.id,{content:{...s.content,filters:clone(filters)}});}},
    save:id=>client?.save(id),restore:async()=>{await refresh();let id;try{id=localStorage.getItem(storageKey());}catch{}if(id&&surfaces.has(id))await focus(id);}};
  window.addEventListener('entity-admin-tab',event=>{
    const tab=event.detail?.name;if(tab&&tab!=='home'&&$('entityTab-'+tab))window.UnaMount?.claim('entity:'+tab,$('entityTab-'+tab),'menu');
  });
  window.addEventListener('focus',()=>{if(window.UnaWorkspace?.isOpen)void refresh();});
  window.addEventListener('pagehide',()=>{void client?.flush(true);});
  window.addEventListener('caca-scope-change',()=>{reset();});
})();
