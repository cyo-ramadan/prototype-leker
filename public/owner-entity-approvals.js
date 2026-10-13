// One H-only entity inbox; decisions use the existing transaction owners.
(() => {
  let current = null;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => new Intl.NumberFormat('id-ID', { style:'currency', currency:'IDR', maximumFractionDigits:0 }).format(Number(v) || 0);
  const date = v => v && !Number.isNaN(new Date(v).getTime()) ? new Intl.DateTimeFormat('id-ID',{ dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta' }).format(new Date(v)) : '';
  const labels = { pending:'Menunggu',pending_approval:'Menunggu',approved:'Disetujui',rejected:'Ditolak',expired:'Kedaluwarsa',cancelled:'Dibatalkan' };
  async function api(s, path, options = {}) {
    const token = s.options.getToken();
    if (!token) throw new Error('Sesi admin telah berakhir.');
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(path + separator + 'store=' + encodeURIComponent(s.options.storeCode), {
      ...options, cache:'no-store', headers:{ Authorization:'Bearer ' + token, 'Content-Type':'application/json' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Persetujuan belum dapat diproses.');
    return data;
  }
  function rows(s) {
    const result = [], groups = new Map();
    for (const item of s.items.filter(i => (s.mode === 'pending' ? i.pending || i.retry : !i.pending && !i.retry) && (!s.store || i.storeCode === s.store))) {
      const session = item.kind === 'operation' && item.data.payload?.purpose === 'STOCK_ADJUSTMENT' && item.data.payload?.sessionId;
      const key = session && item.pending ? item.storeCode + ':' + session : '';
      if (key && groups.has(key)) groups.get(key).group.push(item);
      else { const entry = {...item,group:[item],sessionId:key ? session : null}; result.push(entry); if(key) groups.set(key,entry); }
    }
    return result;
  }
  function detail(i) {
    const p = i.data.payload || {};
    if (i.kind === 'operation' && p.purpose === 'STOCK_ADJUSTMENT') {
      return i.group.map(x => { const v=x.data.payload; return esc(v.productName || 'Barang') + ': ' + esc(v.currentQuantitySnapshot) + ' → ' + esc(v.targetQuantity) + ' ' + esc(v.unitSymbol || ''); }).join('<br>');
    }
    if (i.kind === 'void') return esc(i.data.subject?.description || i.data.subjectId) + '<br>Pembatalan mengikuti transaksi asal; hasil uang dan stok tercatat pada riwayat.';
    if (i.kind === 'close') return 'Laci ' + esc(i.data.targetCashierName || '') + ' · kas fisik ' + money(i.data.closingAmount);
    if (i.kind === 'deposit') return 'Transfer: ' + esc(date(i.data.transferAt)) + '<br>' + esc(i.data.sharedAccountName || 'Kas') + ' · ' + esc(i.data.proofReference || '') + (i.data.hasPhoto ? '<br><button type="button" class="mini-btn" data-proof="' + esc(i.key) + '">Lihat bukti transfer</button>' : '<br>Tanpa foto bukti');
    if (i.kind === 'attendance') return 'Jam masuk: ' + esc(date(i.data.originalCheckInAt)) + ' → ' + esc(date(i.data.requestedCheckInAt));
    return esc(p.description || p.productName || i.data.phone || i.data.originalStatus || '');
  }
  function render(s) {
    if (current !== s) return;
    const display = rows(s);
    const count = s.items.filter(i=>i.pending || i.retry).length;
    s.options.onChange?.({count,complete:s.complete});
    const stores = [...new Map(s.items.map(i=>[i.storeCode,i.storeName])).entries()];
    s.host.innerHTML = '<div class="list-head"><h2>Persetujuan seluruh gerai</h2><button type="button" class="mini-btn" data-refresh>Muat ulang</button></div>' +
      '<div class="owner-approval-filters"><button type="button" class="secondary-btn" data-mode="pending" aria-pressed="'+(s.mode==='pending')+'">Menunggu · '+count+(s.complete?'':'+')+'</button> <button type="button" class="secondary-btn" data-mode="done" aria-pressed="'+(s.mode==='done')+'">Selesai</button> <select class="text-input" aria-label="Filter gerai"><option value="">Seluruh gerai</option>'+stores.map(([code,name])=>'<option value="'+esc(code)+'" '+(s.store===code?'selected':'')+'>'+esc(name||code)+'</option>').join('')+'</select></div>' +
      (s.errors.length ? '<p role="alert">Sebagian pengajuan belum termuat: '+s.errors.map(e=>esc(e.storeCode)+': '+esc(e.error)).join('; ')+'</p>' : '') +
      (s.limited ? '<p class="muted">Menampilkan riwayat terbaru. Daftar sumber mencapai batas tampilan; periksa juga gerai terkait.</p>' : '') +
      '<div data-result role="status"></div><div class="master-list">'+(display.length?display.map(i=>'<article class="master-row"><div class="master-main"><strong>'+esc(i.title)+(i.group.length>1?' · '+i.group.length+' barang':'')+'</strong><div>'+esc(i.storeName||i.storeCode)+' · '+esc(i.actor)+'</div><div class="muted">'+esc(date(i.createdAt))+' · '+esc(i.retry?'Perlu diselesaikan':labels[i.status]||i.status)+'</div>'+(i.amount!==null?'<b>'+money(i.amount)+'</b>':'')+'<p>'+esc(i.reason)+'</p><details><summary>Rincian</summary><p>'+detail(i)+'</p><div data-photo="'+esc(i.key)+'"></div></details>'+(i.pending||i.retry?'<label>Catatan<input class="text-input" data-note="'+esc(i.key)+'" placeholder="Wajib untuk penolakan" maxlength="500"></label><div class="master-actions">'+(i.pending?'<button type="button" class="secondary-btn" data-decision="REJECT" data-key="'+esc(i.key)+'">Tolak</button>':'')+'<button type="button" class="primary-btn" data-decision="'+(i.retry?'RETRY_EXECUTION':'ACC')+'" data-key="'+esc(i.key)+'">'+(i.retry?'Selesaikan proses':'Setujui')+'</button></div>':'')+'</div></article>').join(''):'<p class="empty">'+(s.complete?'Tidak ada pengajuan pada pilihan ini.':'Data belum lengkap. Muat ulang untuk memeriksa pengajuan.')+'</p>')+'</div>';
    s.host.querySelector('[data-refresh]').onclick=()=>load(s);
    s.host.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{s.mode=b.dataset.mode;load(s);});
    s.host.querySelector('select').onchange=e=>{s.store=e.target.value;render(s);};
    s.host.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>decide(s,display.find(i=>i.key===b.dataset.key),b.dataset.decision));
    s.host.querySelectorAll('[data-proof]').forEach(b=>b.onclick=()=>photo(s,display.find(i=>i.key===b.dataset.proof),b));
  }
  async function photo(s,i,button) {
    button.disabled=true;
    try {
      const response=await fetch('/api/admin/employee-deposits/payments/'+encodeURIComponent(i.id)+'/photo?store='+encodeURIComponent(i.storeCode),{headers:{Authorization:'Bearer '+s.options.getToken()}});
      if(!response.ok) throw new Error('Bukti belum dapat dimuat.');
      const url=URL.createObjectURL(await response.blob());
      if(current!==s){URL.revokeObjectURL(url);return;}
      s.urls.push(url); const img=document.createElement('img'); img.src=url;img.alt='Bukti transfer '+(i.actor||'CS');img.style.cssText='max-width:100%;max-height:420px;object-fit:contain';
      [...s.host.querySelectorAll('[data-photo]')].find(n=>n.dataset.photo===i.key)?.replaceChildren(img);
    } catch(e){s.host.querySelector('[data-result]').textContent=e.message;} finally{button.disabled=false;}
  }
  async function decide(s,i,decision) {
    if(!i||s.busy)return;
    const note=[...s.host.querySelectorAll('[data-note]')].find(n=>n.dataset.note===i.key)?.value.trim()||'';
    if(decision==='REJECT'&&note.length<3){s.host.querySelector('[data-result]').textContent='Isi alasan penolakan minimal tiga karakter.';return;}
    if(i.kind==='deposit'&&decision==='ACC'&&!confirm('Setujui setoran '+money(i.amount)+' dari '+i.actor+'? Pastikan nominal, waktu, dan bukti cocok dengan mutasi rekening.'))return;
    s.busy=true;s.host.querySelectorAll('[data-decision]').forEach(b=>b.disabled=true);
    try{
      const result=await api(s,'/api/management/owner-entity/approvals/decision',{method:'POST',body:JSON.stringify({kind:i.kind,id:i.id,storeCode:i.storeCode,decision,note,sessionId:i.sessionId})});
      await load(s);
      if(current===s)s.host.querySelector('[data-result]').textContent=result.executionHold?'Disetujui; pelaksanaan masih perlu diselesaikan. Buka Selesai untuk melihat rinciannya.':result.accounting?.ok===false?'Operasional tercatat; pembukuan masih perlu diperiksa.':'Keputusan tersimpan.';
      document.dispatchEvent(new CustomEvent('owner-entity:decision'));
    }catch(e){if(current===s){s.host.querySelector('[data-result]').textContent=e.message;s.host.querySelectorAll('[data-decision]').forEach(b=>b.disabled=false);}}
    finally{s.busy=false;}
  }
  async function load(s) {
    const sequence=++s.sequence;
    try{
      const data=await api(s,'/api/management/owner-entity/approvals?status='+(s.mode==='done'?'all':'pending'));
      if(current!==s||sequence!==s.sequence)return;
      s.urls.forEach(URL.revokeObjectURL);s.urls=[];
      s.items=data.items||[];s.errors=data.errors||[];s.complete=data.complete;s.limited=data.limited;render(s);
    }catch(e){if(current===s&&sequence===s.sequence){s.complete=false;s.errors=[{storeCode:'',error:e.message}];s.items=[];render(s);}}
  }
  function destroy(){if(current){current.urls.forEach(URL.revokeObjectURL);current.host.replaceChildren();current=null;}}
  window.OwnerEntityApprovals={mount(host,options){destroy();const s=current={host,options,items:[],errors:[],mode:'pending',store:'',complete:false,limited:false,urls:[],sequence:0,busy:false};host.textContent='Memuat persetujuan seluruh gerai…';return load(s);},destroy};
})();
