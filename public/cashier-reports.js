(() => {
  // Tombol Laporan -- extensible ke rekapan custome lain nanti, saat ini baru
  // Saldo Stok. REPORTS didaftar sebagai array supaya nambah jenis laporan
  // baru cukup nambah 1 entri di sini, tidak perlu ubah struktur dialog.
  const REPORTS = [
    { id: 'stock-balance', label: '📦 Saldo Stok', open: openStockBalanceMenu }
  ];

  const state = {
    picker: [],
    groups: [],
    activeGroup: null
  };

  function ensureDialog() {
    if (el('cashierReportsDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="cashierReportsDialog" class="cashier-dialog" style="max-width:min(1080px,96vw);width:96vw">
        <div class="cashier-dialog-head">
          <div><div class="muted">Rekapan gerai</div><h2 id="cashierReportsTitle">Laporan</h2></div>
          <button id="cashierReportsClose" class="cart-close-btn" type="button">×</button>
        </div>
        <div id="cashierReportsBody"></div>
      </dialog>`);
    el('cashierReportsClose').onclick = () => el('cashierReportsDialog').close();
  }

  function openReports() {
    ensureDialog();
    renderMenu();
    el('cashierReportsDialog').showModal();
  }

  function renderMenu() {
    el('cashierReportsTitle').textContent = 'Laporan';
    el('cashierReportsBody').innerHTML = `
      <div class="master-list">${REPORTS.map(report => `
        <button class="secondary-btn" type="button" data-report="${report.id}" style="width:100%;text-align:left;margin-bottom:8px">${escapeHtml(report.label)}</button>
      `).join('')}</div>`;
    el('cashierReportsBody').querySelectorAll('[data-report]').forEach(button => {
      button.addEventListener('click', () => REPORTS.find(report => report.id === button.dataset.report)?.open());
    });
  }

  function openStockBalanceMenu() {
    el('cashierReportsTitle').textContent = 'Laporan · Saldo Stok';
    el('cashierReportsBody').innerHTML = `
      <button id="cashierReportsBack" class="text-btn" type="button">← Laporan</button>
      <div class="master-list" style="margin-top:10px">
        <button class="secondary-btn" type="button" data-flow="all" style="width:100%;text-align:left;margin-bottom:8px">Semua Barang</button>
        <button class="secondary-btn" type="button" data-flow="selected" style="width:100%;text-align:left;margin-bottom:8px">Pilih Barang</button>
        <button class="secondary-btn" type="button" data-flow="group" style="width:100%;text-align:left;margin-bottom:8px">Group Barang</button>
        <button class="secondary-btn" type="button" data-flow="create-group" style="width:100%;text-align:left">Buat Group Barang</button>
      </div>`;
    el('cashierReportsBack').addEventListener('click', renderMenu);
    el('cashierReportsBody').querySelector('[data-flow="all"]').addEventListener('click', () => runStockBalance({ scope: 'ALL' }));
    el('cashierReportsBody').querySelector('[data-flow="selected"]').addEventListener('click', openSelectedFlow);
    el('cashierReportsBody').querySelector('[data-flow="group"]').addEventListener('click', openGroupFlow);
    el('cashierReportsBody').querySelector('[data-flow="create-group"]').addEventListener('click', openCreateGroupFlow);
  }

  // --- Pemilih barang search-and-add: dipakai bareng oleh alur "Pilih Barang"
  // dan "Buat Group Barang" -- UX-nya sama seperti mengisi Penjualan (cari,
  // klik tambahkan, muncul di bawah), tapi tanpa qty/harga karena di sini
  // barang cuma anggota daftar, bukan baris transaksi.
  function renderProductPicker() {
    const query = String(el('cashierReportsPickerSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
    const chosen = new Set(state.picker.map(item => item.id));
    const results = !query ? [] : (state.products || [])
      .filter(product => !chosen.has(Number(product.id)) && product.name.toLocaleLowerCase('id-ID').includes(query))
      .slice(0, 8);
    const resultsHost = el('cashierReportsPickerResults');
    if (resultsHost) {
      resultsHost.innerHTML = results.length
        ? results.map(product => `<button type="button" data-add="${product.id}"><strong>${escapeHtml(product.name)}</strong></button>`).join('')
        : (query ? '<div class="pimasatu-empty">Tidak ditemukan.</div>' : '');
      resultsHost.classList.toggle('hidden', !results.length && !query);
    }
    const linesHost = el('cashierReportsPickerLines');
    if (linesHost) {
      linesHost.innerHTML = state.picker.length
        ? state.picker.map(item => `<div class="master-row" style="align-items:center"><div class="master-main"><strong>${escapeHtml(item.name)}</strong></div><div class="master-actions"><button class="text-btn" type="button" data-remove="${item.id}">Hapus</button></div></div>`).join('')
        : '<div class="muted pimasatu-empty">Belum ada barang dipilih.</div>';
    }
  }

  function mountProductPicker(host) {
    host.innerHTML = `
      <div class="field pimasatu-search-wrap">
        <label>Cari barang</label>
        <input id="cashierReportsPickerSearch" class="text-input" autocomplete="off" placeholder="Cari dan pilih" />
        <div id="cashierReportsPickerResults" class="pimasatu-results hidden"></div>
      </div>
      <div id="cashierReportsPickerLines" class="master-list" style="margin-top:10px"></div>`;
    state.picker = [];
    renderProductPicker();
    el('cashierReportsPickerSearch').addEventListener('input', renderProductPicker);
    el('cashierReportsPickerResults').addEventListener('click', event => {
      const button = event.target.closest('[data-add]');
      if (!button) return;
      const product = (state.products || []).find(item => Number(item.id) === Number(button.dataset.add));
      if (!product) return;
      state.picker.push({ id: Number(product.id), name: product.name });
      el('cashierReportsPickerSearch').value = '';
      renderProductPicker();
    });
    el('cashierReportsPickerLines').addEventListener('click', event => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      state.picker = state.picker.filter(item => item.id !== Number(button.dataset.remove));
      renderProductPicker();
    });
  }

  function openSelectedFlow() {
    el('cashierReportsTitle').textContent = 'Laporan · Saldo Stok · Pilih Barang';
    el('cashierReportsBody').innerHTML = `
      <button id="cashierReportsBack" class="text-btn" type="button">← Saldo Stok</button>
      <div id="cashierReportsPicker" style="margin-top:10px"></div>
      <button id="cashierReportsShow" class="primary-btn" type="button" style="margin-top:12px">Tampilkan</button>`;
    el('cashierReportsBack').addEventListener('click', openStockBalanceMenu);
    mountProductPicker(el('cashierReportsPicker'));
    el('cashierReportsShow').addEventListener('click', () => {
      if (!state.picker.length) return toast('Pilih minimal 1 barang.');
      runStockBalance({ scope: 'SELECTED', productIds: state.picker.map(item => item.id) });
    });
  }

  function openCreateGroupFlow() {
    el('cashierReportsTitle').textContent = 'Laporan · Saldo Stok · Buat Group Barang';
    el('cashierReportsBody').innerHTML = `
      <button id="cashierReportsBack" class="text-btn" type="button">← Saldo Stok</button>
      <div class="field" style="margin-top:10px"><label>Nama group</label><input id="cashierReportsGroupName" class="text-input" maxlength="80" placeholder="Misal: Bahan Larutan Jasmin" /></div>
      <div id="cashierReportsPicker" style="margin-top:10px"></div>
      <button id="cashierReportsSaveGroup" class="primary-btn" type="button" style="margin-top:12px">Simpan</button>`;
    el('cashierReportsBack').addEventListener('click', openStockBalanceMenu);
    mountProductPicker(el('cashierReportsPicker'));
    el('cashierReportsSaveGroup').addEventListener('click', async () => {
      const name = el('cashierReportsGroupName').value.trim();
      if (!name) return toast('Nama group wajib diisi.');
      if (!state.picker.length) return toast('Pilih minimal 1 barang.');
      try {
        await api('/api/cashier/product-groups', {
          method: 'POST',
          body: JSON.stringify({ name, productIds: state.picker.map(item => item.id) })
        });
        toast(`Group "${name}" tersimpan.`);
        openStockBalanceMenu();
      } catch (error) {
        toast(error.message);
      }
    });
  }

  async function openGroupFlow() {
    el('cashierReportsTitle').textContent = 'Laporan · Saldo Stok · Group Barang';
    el('cashierReportsBody').innerHTML = `<button id="cashierReportsBack" class="text-btn" type="button">← Saldo Stok</button><div id="cashierReportsGroupList" style="margin-top:10px" class="muted">Memuat group...</div>`;
    el('cashierReportsBack').addEventListener('click', openStockBalanceMenu);
    try {
      const payload = await api('/api/cashier/product-groups');
      state.groups = payload.groups || [];
      renderGroupList();
    } catch (error) {
      el('cashierReportsGroupList').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderGroupList() {
    const host = el('cashierReportsGroupList');
    host.innerHTML = state.groups.length
      ? `<div class="master-list">${state.groups.map(group => `
          <article class="master-row" style="align-items:center">
            <div class="master-main"><strong>${escapeHtml(group.name)}</strong><div class="master-meta">${group.itemCount} barang</div></div>
            <div class="master-actions"><button class="mini-btn" type="button" data-group="${group.id}">Pilih</button></div>
          </article>`).join('')}</div>`
      : '<div class="empty">Belum ada group barang. Buat lewat "Buat Group Barang".</div>';
    host.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => openGroupDetail(button.dataset.group)));
  }

  async function openGroupDetail(groupId) {
    const host = el('cashierReportsGroupList');
    host.innerHTML = '<div class="muted">Memuat isi group...</div>';
    try {
      const payload = await api(`/api/cashier/product-groups/${groupId}`);
      state.activeGroup = { id: groupId, name: payload.group.name, items: payload.items || [] };
      host.innerHTML = `
        <div class="muted">Group: <b>${escapeHtml(state.activeGroup.name)}</b></div>
        <div class="master-list" style="margin-top:8px">${state.activeGroup.items.map(item => `<div class="master-row"><div class="master-main"><strong>${escapeHtml(item.productName)}</strong></div></div>`).join('')}</div>
        <button id="cashierReportsShowGroup" class="primary-btn" type="button" style="margin-top:12px">Tampilkan</button>`;
      el('cashierReportsShowGroup').addEventListener('click', () => runStockBalance({ scope: 'GROUP', groupId }));
    } catch (error) {
      host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function runStockBalance({ scope, productIds, groupId }) {
    el('cashierReportsTitle').textContent = 'Laporan · Saldo Stok';
    el('cashierReportsBody').innerHTML = `<button id="cashierReportsBack" class="text-btn" type="button">← Saldo Stok</button><div id="cashierReportsResult" style="margin-top:10px" class="muted">Memuat saldo stok...</div>`;
    el('cashierReportsBack').addEventListener('click', openStockBalanceMenu);
    try {
      const url = new URL('/api/cashier/reports/stock-balance', location.origin);
      url.searchParams.set('scope', scope);
      if (productIds) url.searchParams.set('productIds', productIds.join(','));
      if (groupId) url.searchParams.set('groupId', groupId);
      const payload = await api(`${url.pathname}${url.search}`);
      renderStockResult(payload.stocks || []);
    } catch (error) {
      el('cashierReportsResult').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderStockResult(stocks) {
    const host = el('cashierReportsResult');
    host.innerHTML = stocks.length
      ? `<div class="master-list">${stocks.map(item => {
          const qty = item.quantity == null ? 'Belum diinisialisasi' : `${item.quantity} ${escapeHtml(item.unitSymbol || '')}`;
          return `<article class="master-row"><div class="master-main"><strong>${escapeHtml(item.productName)}</strong><div class="master-meta">${escapeHtml(item.itemTypeName || 'Tanpa tipe')}</div><div class="master-prices"><span>Saldo</span><span><b>${qty}</b></span></div></div></article>`;
        }).join('')}</div>`
      : '<div class="empty">Tidak ada barang pada cakupan ini.</div>';
  }

  el('reportsBtn')?.addEventListener('click', openReports);
})();
