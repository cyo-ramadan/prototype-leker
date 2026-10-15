/* Trusted code registers semantic handlers. Model output never supplies DOM selectors or code. */
(() => {
  'use strict';
  function create(options = {}) {
    const manifest = options.manifest || window.UNA_KEMAMPUAN;
    const validator = options.validator || window.UnaKemampuanValidasi;
    if (!manifest || !validator) throw new Error('Data kemampuan belum dimuat.');
    let getContext = options.getContext || (() => ({}));
    let generation = 0;
    const handlers = new Map(), completed = new Map(), pending = new Map(), latest = new Map(), readJobs = new Map();
    const descriptors = manifest.capabilities;
    const emit = receipt => window.dispatchEvent(new CustomEvent('una-live:receipt',{detail:receipt}));
    const menus = ({skin,peran,halaman}) => {
      if (!['OWNER','ENTITY_ADMIN','ADMIN'].includes(peran)) return [];
      if (peran === 'ADMIN' && halaman !== 'gerai') return [];
      const selectedSkin = skin === '0' ? 'classic' : String(skin).toLowerCase();
      return manifest.menus.filter(m => m.skin === selectedSkin && m.halaman === halaman);
    };
    const invalid = (command,status,code,message) => validator.rejectAction(command,status,code,message);
    function remember(command,receipt) {
      if(typeof command?.actionId==='string'&&/^[\w-]{1,100}$/.test(command.actionId))completed.set(command.actionId,receipt);
      if (completed.size > 100) completed.delete(completed.keys().next().value);
      emit(receipt);
      return receipt;
    }
    function register(id,handler) {
      if (!descriptors.some(c => c.id === id) || !handler || typeof handler.execute !== 'function') throw new Error('Handler kemampuan tidak valid.');
      if (handlers.has(id)) throw new Error('Handler sudah terdaftar: '+id);
      handlers.set(id,handler);
      return () => { if (handlers.get(id) === handler) handlers.delete(id); };
    }
    async function perform(command,context,marker,key,sequence,validated,job) {
      const descriptor = validated.descriptor, handler = handlers.get(descriptor.id);
      const stale = () => marker !== generation || getContext().scopeEpoch !== command.scopeEpoch;
      const superseded = () => latest.get(key) !== sequence;
      if (!handler) return remember(command,invalid(command,'rejected','PRECONDITION_FAILED','Kemampuan ini belum terhubung ke halaman.'));
      try {
        const result = await handler.execute(validated.command.params,{command:validated.command,context,isCurrent:() => !stale() && !superseded() && !job.cancelled});
        if (stale()) return invalid(command,'stale','SCOPE_CHANGED','Lingkup percakapan sudah berubah.');
        if (job.cancelled) return remember(command,invalid(command,'cancelled','SUPERSEDED','Pembacaan dihentikan.'));
        if (superseded()) return remember(command,invalid(command,'superseded','SUPERSEDED','Tindakan digantikan perintah yang lebih baru.'));
        if (!result || result.ok === false) return remember(command,invalid(command,result?.status || 'failed',result?.code || 'DATA_FAILED',result?.message || 'Tindakan belum berhasil.'));
        if (descriptor.proof !== 'none') {
          if (result.proof?.kind !== descriptor.proof || typeof handler.verify !== 'function' || await handler.verify(result,validated.command,getContext()) !== true) {
            return remember(command,invalid(command,'failed','NOT_VERIFIED','Hasil tindakan belum dapat dipastikan.'));
          }
          if (stale()) return invalid(command,'stale','SCOPE_CHANGED','Lingkup percakapan sudah berubah.');
          if (job.cancelled) return remember(command,invalid(command,'cancelled','SUPERSEDED','Pembacaan dihentikan.'));
        if (superseded()) return remember(command,invalid(command,'superseded','SUPERSEDED','Tindakan digantikan perintah yang lebih baru.'));
        }
        let summary = {};
        try { const text = JSON.stringify(result.summary || {}); if (new TextEncoder().encode(text).length <= 2048) summary = JSON.parse(text); } catch {}
        const receipt = {...invalid(command,'ok',null,result.message || 'Tindakan selesai.'),
          surfaceId:result.surfaceId || command.target?.surfaceId || null,
          resultRevision:Number.isSafeInteger(result.resultRevision) ? result.resultRevision : null,
          summary,proof:result.proof || null};
        return remember(command,receipt);
      } catch {
        if (stale()) return invalid(command,'stale','SCOPE_CHANGED','Lingkup percakapan sudah berubah.');
        if (job.cancelled) return remember(command,invalid(command,'cancelled','SUPERSEDED','Pembacaan dihentikan.'));
        if (superseded()) return remember(command,invalid(command,'superseded','SUPERSEDED','Tindakan digantikan perintah yang lebih baru.'));
        return remember(command,invalid(command,'failed','DATA_FAILED','Tindakan gagal. Periksa halaman sebelum mengulang.'));
      }
    }
    function execute(command) {
      const context = getContext();
      if (!command || command.scopeEpoch !== context.scopeEpoch) return Promise.resolve(invalid(command,'stale','SCOPE_CHANGED','Lingkup percakapan sudah berubah.'));
      if (completed.has(command.actionId)) return Promise.resolve({...completed.get(command.actionId),replayed:true});
      if (pending.has(command.actionId)) return pending.get(command.actionId).then(r => ({...r,replayed:true}));
      const validated = validator.validateAction(command,context,descriptors,{menuUntuk:menus,refs:{'canvas.operation':value=>window.UnaKanvasPatch?.validateCanvasOperation(value)===true,...options.refs}});
      if (!validated.ok) return Promise.resolve(remember(command,validated.receipt));
      const key = command.target?.surfaceId || (validated.descriptor.page ? validated.descriptor.page.halaman+':'+validated.descriptor.page.tab : context.activeSurfaceId || command.capabilityId);
      const sequence = (latest.get(key) || 0)+1;
      latest.set(key,sequence);
      const job={cancelled:false};
      if(['read','view'].includes(validated.descriptor.category))readJobs.set(command.actionId,job);
      const promise = perform(command,context,generation,key,sequence,validated,job);
      pending.set(command.actionId,promise);
      void promise.finally(() => { if (pending.get(command.actionId) === promise) pending.delete(command.actionId);if(readJobs.get(command.actionId)===job)readJobs.delete(command.actionId); });
      return promise;
    }
    function cancelReads(){let count=0;for(const job of readJobs.values())if(!job.cancelled){job.cancelled=true;count++;}return count;}
    function reset() { generation++; completed.clear(); pending.clear(); latest.clear();readJobs.clear(); }
    function configure(value) { reset(); getContext = value; }
    function catalogue() {
      const c = getContext();
      return descriptors.filter(d => d.modelVisible && d.roles.includes(c.role) && d.scopes.includes(c.lingkup) && validator.relevantCapability(d,c)
        && (!d.page || menus({skin:c.skin || 'classic',peran:c.role,halaman:d.page.halaman}).some(m => m.tab === d.page.tab)))
        .map(d => ({id:d.id,version:d.version,label:d.label,aliases:d.aliases,params:d.params}));
    }
    return {register,execute,reset,configure,catalogue,cancelReads};
  }
  let current = null;
  const instance = () => current || (current = create());
  window.UnaRegistry = {create,register:(...args)=>instance().register(...args),execute:(...args)=>instance().execute(...args),
    configure:value=>instance().configure(value),reset:()=>current?.reset(),catalogue:()=>instance().catalogue(),cancelReads:()=>current?.cancelReads()||0};
})();
