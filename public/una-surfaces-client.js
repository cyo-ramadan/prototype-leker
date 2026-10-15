/* Event-driven artifact persistence. No timers except a pending edit's debounce. */
(() => {
  'use strict';
  const clone = v => JSON.parse(JSON.stringify(v));
  function create(options) {
    const entries=new Map();let epoch=0;
    const identity=options.getIdentity(),scope=options.getScope();
    const current=marker=>marker===epoch&&identity===options.getIdentity()&&scope===options.getScope();
    const notify=e=>options.onChange?.(e);
    async function request(path='',settings={}) {
      const marker=epoch;if(!current(marker))throw new Error('Lingkup lembar berubah.');
      const result=await options.api('/api/caca/surfaces'+path+'?'+options.scopeQuery(scope),settings);
      if(!current(marker))throw new Error('Lingkup lembar berubah.');return result;
    }
    function put(surface) {
      let entry=entries.get(surface.id);
      if(!entry){entry={surface:clone(surface),dirty:false,serial:0,status:'Tersimpan',timer:null,pending:null,conflict:null};entries.set(surface.id,entry);}
      else if(!entry.dirty&&surface.revision>=entry.surface.revision){entry.surface=clone(surface);entry.needsReload=false;entry.conflict=null;entry.status='Tersimpan';}
      else if(surface.revision>entry.surface.revision){entry.conflict=clone(surface);entry.status='Ada versi baru';}
      notify(entry);return entry;
    }
    async function list(){
      const result=await request();
      for(const s of result.items||[]){
        if(s.content)put(s);
        else {const e=entries.get(s.id);if(e&&s.revision>e.surface.revision){e.status='Ada versi baru';e.needsReload=true;notify(e);}}
      }
      return result.items||[];
    }
    async function open(id){const result=await request('/'+encodeURIComponent(id));return put(result.surface);}
    async function add(body){const result=await request('',{method:'POST',body:JSON.stringify(body)});return put(result.surface);}
    function edit(id,change){
      const e=entries.get(id);if(!e)throw new Error('Lembar belum terbuka.');
      e.surface={...e.surface,...clone(change)};e.dirty=true;e.serial++;e.status='Belum tersimpan';
      clearTimeout(e.timer);if(!e.conflict)e.timer=setTimeout(()=>{void save(id);},1500);notify(e);return e;
    }
    async function save(id,keepalive=false) {
      const e=entries.get(id);if(!e||!e.dirty||e.conflict)return false;
      clearTimeout(e.timer);if(e.pending){await e.pending;return e.dirty&&!e.conflict?save(id,keepalive):!e.dirty;}
      const serial=e.serial,marker=epoch,body={expectedRevision:e.surface.revision,title:e.surface.title,content:clone(e.surface.content)};
      e.status='Menyimpan…';notify(e);
      e.pending=(async()=>{
        try {
          const result=await request('/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body),keepalive});
          if(!current(marker))return false;
          if(e.serial===serial){e.surface=clone(result.surface);e.dirty=false;e.status='Tersimpan';}
          else {e.surface.revision=result.surface.revision;e.status='Belum tersimpan';}
          notify(e);return !e.dirty;
        } catch(error){
          if(!current(marker))return false;
          if(error.status===409&&error.payload?.surface){e.conflict=clone(error.payload.surface);e.status='Ada versi baru';}
          else e.status='Belum tersimpan';
          notify(e);return false;
        }
      })();
      const result=await e.pending;e.pending=null;
      if(current(marker)&&e.serial!==serial&&e.dirty&&!e.conflict){clearTimeout(e.timer);e.timer=setTimeout(()=>{void save(id);},1500);}
      return result;
    }
    async function resolve(id,choice){
      const e=entries.get(id);if(!e?.conflict)throw new Error('Tidak ada konflik lembar.');
      if(choice==='server'){
        const serial=e.serial,fresh=await request('/'+encodeURIComponent(id));
        if(e.serial!==serial){e.conflict=clone(fresh.surface);e.status='Ada versi baru';notify(e);throw new Error('Edit baru tetap disimpan lokal. Pilih lagi cara menyelesaikan konflik.');}
        clearTimeout(e.timer);e.surface=clone(fresh.surface);e.dirty=false;e.conflict=null;e.needsReload=false;e.serial++;e.status='Tersimpan';notify(e);return e;
      }
      if(choice==='copy'){
        if(e.surface.kind!=='canvas')throw new Error('Halaman unik; ekspor filter lokal atau muat versi server.');
        return add({kind:e.surface.kind,title:(e.surface.title+' (salinan)').slice(0,80),content:clone(e.surface.content)});
      }
      throw new Error('Pilih cara menyelesaikan konflik.');
    }
    async function flush(keepalive=false){return Promise.all([...entries.keys()].map(id=>save(id,keepalive)));}
    function reset(){epoch++;for(const e of entries.values())clearTimeout(e.timer);entries.clear();}
    return {list,open,add,edit,save,resolve,flush,reset,get:id=>entries.get(id),values:()=>[...entries.values()]};
  }
  window.UnaSurfacesClient={create};
})();
