(() => {
  let snapshot = { costTypes: [], costs: [] };
  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || document.getElementById('tab-costmasters')) return;
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'costmasters';
    button.type = 'button';
    button.textContent = 'Master Biaya';
    button.addEventListener('click', () => { switchTab('costmasters'); load(); });
    tabs.appendChild(button);
    shell.insertAdjacentHTML('beforeend', `<section id="tab-costmasters" class="admin-section"><div class="admin-grid master-layout"><form id="costMasterForm" class="admin-card sticky-form"><input id="costMasterId" type="hidden"><div class="form-title-row"><h2 id="costMasterTitle">Tambah biaya</h2><button id="costMasterCancel" class="text-btn hidden" type="button">Batal edit</button></div><label class="admin-field">Nama biaya<input id="costMasterName" maxlength="100" required></label><label class="admin-field">Kontak<input id="costMasterContact" maxlength="120"></label><div class="admin-grid two compact"><label class="admin-field">Biaya keluar<input id="costMasterOutgoing" type="number" min="0" step="1" required></label><label class="admin-field">Biaya masuk<input id="costMasterIncoming" type="number" min="0" step="1" required></label></div><label class="admin-field">Jenis Biaya<select id="costMasterType" required></select><span class="field-note">Kategori transaksi: Operasional. Mapping akun diatur di Setting Akuntansi.</span></label><label class="admin-field">Kelompok biaya<input id="costMasterGroup" maxlength="80" required placeholder="Contoh: Logistik"></label><label class="admin-check"><input id="costMasterActive" type="checkbox" checked> Aktif</label><button class="primary-btn" type="submit">Simpan biaya</button></form><div class="admin-card list-card"><div class="list-head"><h2>Master Biaya</h2><span id="costMasterCount" class="master-count">0</span></div><div id="costMasterList" class="master-list"></div></div></div></section>`);
    el('costMasterForm').addEventListener('submit', save);
    el('costMasterCancel').addEventListener('click', reset);
  }
  async function load() {
    snapshot = await api('/api/admin/master/costs');
    el('costMasterType').innerHTML = snapshot.costTypes.filter(type => type.isActive).map(type => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)}</option>`).join('');
    el('costMasterCount').textContent = snapshot.costs.length;
    el('costMasterList').innerHTML = snapshot.costs.length ? snapshot.costs.map(cost => `<article class="master-row"><div class="master-main"><strong>${escapeHtml(cost.name)}</strong><span>${escapeHtml(cost.costGroup)} · ${escapeHtml(cost.costTypeName)} · keluar ${rupiah(cost.outgoingAmount)} · masuk ${rupiah(cost.incomingAmount)}</span><small>${escapeHtml(cost.contact || 'Tanpa kontak')} · ${cost.isActive ? 'Aktif' : 'Nonaktif'}</small></div><button class="text-btn" type="button" data-edit-cost="${escapeHtml(cost.id)}">Edit</button></article>`).join('') : '<div class="empty">Belum ada Master Biaya.</div>';
    document.querySelectorAll('[data-edit-cost]').forEach(button => button.onclick = () => edit(button.dataset.editCost));
  }
  function edit(id) { const cost=snapshot.costs.find(item=>item.id===id); if(!cost)return; el('costMasterId').value=cost.id; el('costMasterName').value=cost.name; el('costMasterContact').value=cost.contact; el('costMasterOutgoing').value=cost.outgoingAmount; el('costMasterIncoming').value=cost.incomingAmount; el('costMasterType').value=cost.costTypeId; el('costMasterGroup').value=cost.costGroup; el('costMasterActive').checked=cost.isActive; el('costMasterTitle').textContent='Edit biaya'; el('costMasterCancel').classList.remove('hidden'); }
  function reset(){ el('costMasterForm').reset(); el('costMasterId').value=''; el('costMasterActive').checked=true; el('costMasterTitle').textContent='Tambah biaya'; el('costMasterCancel').classList.add('hidden'); }
  async function save(event){ event.preventDefault(); const id=el('costMasterId').value; await api(id?`/api/admin/master/costs/${encodeURIComponent(id)}`:'/api/admin/master/costs',{method:id?'PATCH':'POST',body:JSON.stringify({name:el('costMasterName').value,contact:el('costMasterContact').value,outgoingAmount:Number(el('costMasterOutgoing').value),incomingAmount:Number(el('costMasterIncoming').value),costTypeId:el('costMasterType').value,costGroup:el('costMasterGroup').value,isActive:el('costMasterActive').checked})}); toast('Master Biaya tersimpan'); reset(); await load(); }
  mount();
})();
