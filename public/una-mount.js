/* One live panel, shared by menu, home pin and assistant Workspace. */
(() => {
  'use strict';
  const records = new Map();
  const allowedOwners = new Set(['menu','pin','workspace']);
  function sourceFor(key) {
    const match = /^entity:([\w-]{1,40})$/.exec(key);
    return match ? document.getElementById('entityTab-'+match[1]) : null;
  }
  function removePlaceholder(slot) { slot.placeholder?.remove(); slot.placeholder = null; }
  function placeholder(record, slot) {
    removePlaceholder(slot);
    const box = document.createElement('div');
    box.className = 'una-panel-placeholder';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-btn';
    button.textContent = record.owner === 'workspace' ? 'Sedang dibuka di Workspace, tampilkan di sini' : 'Tampilkan halaman di sini';
    button.addEventListener('click',() => claim(record.key,slot.host,slot.owner));
    box.append(button); slot.host.append(box); slot.placeholder = box;
  }
  function claim(key,host,owner) {
    if (!allowedOwners.has(owner) || !host || typeof host.append !== 'function') throw new Error('Lokasi panel tidak valid.');
    const source = sourceFor(key);
    if (!source || host === source && owner !== 'menu' || source.contains?.(host) && host !== source) throw new Error('Panel tidak tersedia.');
    let record = records.get(key);
    if (!record) {
      const nodes = [...source.childNodes];
      const anchors = nodes.map(node => {
        const anchor = document.createComment('una-panel:'+key);
        source.insertBefore(anchor,node);
        return anchor;
      });
      record = {key,source,nodes,anchors,owner:'menu',host:source,slots:[{host:source,owner:'menu',placeholder:null}]};
      records.set(key,record);
    }
    if (record.host === host && record.owner === owner) return true;
    let slot = record.slots.find(s => s.host === host);
    if (!slot) { slot={host,owner,placeholder:null};record.slots.push(slot); }
    removePlaceholder(slot);
    for (let i=0;i<record.nodes.length;i++) {
      if (host === source) source.insertBefore(record.nodes[i],record.anchors[i]);
      else host.append(record.nodes[i]);
    }
    record.host = host; record.owner = owner;
    for (const other of record.slots) if (other !== slot) placeholder(record,other);
    window.dispatchEvent(new CustomEvent('una-live:surface',{detail:{surfaceId:null,kind:'page',action:'mounted',revision:null,panelKey:key,owner}}));
    return true;
  }
  function release(key) {
    const record = records.get(key);
    if (!record) return false;
    for (let i=0;i<record.nodes.length;i++) { record.source.insertBefore(record.nodes[i],record.anchors[i]);record.anchors[i].remove(); }
    for (const slot of record.slots) removePlaceholder(slot);
    records.delete(key);
    window.dispatchEvent(new CustomEvent('una-live:surface',{detail:{surfaceId:null,kind:'page',action:'mounted',revision:null,panelKey:key,owner:'menu'}}));
    return true;
  }
  const owner = key => records.get(key)?.owner || 'menu';
  function detach(key,host) {
    const record=records.get(key);if(!record)return;
    if(record.host===host)claim(key,record.source,'menu');
    const slot=record.slots.find(s=>s.host===host);if(slot)removePlaceholder(slot);
    record.slots=record.slots.filter(s=>s.host!==host||s.owner==='menu');
    if(record.slots.length===1&&record.host===record.source)release(key);
  }
  const reset = () => { for (const key of [...records.keys()]) release(key); };
  window.UnaMount = {claim,release,owner,reset,detach};
})();
