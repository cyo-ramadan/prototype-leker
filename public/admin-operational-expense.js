(() => {
  // Bea Operasional dari panel Admin Gerai (Bos Cyo, 2026-09-17): Bea Gaji,
  // Bea Lapak, Bea Lainnya. Uang keluar yang dibayar Admin, bukan lewat laci
  // kasir. Backend: src/admin-operational-expense.js -- sudah terdaftar
  // sebagai sumber Beban di Laporan Net Profit, jadi yang dicatat di sini
  // langsung mengurangi untung di laporan.
  //
  // Pola mount-nya mengikuti admin-cost-master.js: nambah tombol tab sendiri
  // ke .admin-tabs dan section sendiri ke #adminApp, pakai helper global
  // (el/api/toast/switchTab/escapeHtml/rupiah) dari admin.js. Tidak perlu
  // menyebut ?store= -- store-context.js yang menempelkannya ke tiap /api/*.
  let snapshot = { expenses: [], categories: [], today: '' };

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || document.getElementById('tab-beaops')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'beaops';
    button.type = 'button';
    button.textContent = '💵 Bea Operasional';
    button.addEventListener('click', () => { switchTab('beaops'); load().catch(error => toast(error.message)); });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-beaops" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="beaOpsForm" class="admin-card sticky-form">
            <div class="form-title-row"><h2>Catat Bea Operasional</h2></div>
            <div class="muted" style="margin-bottom:10px">Pengeluaran yang dibayar dari Admin, bukan dari laci kasir. Yang dicatat di sini langsung mengurangi untung di Laporan Net Profit.</div>
            <label class="admin-field">Jenis bea<select id="beaOpsCategory" required></select></label>
            <label class="admin-field">Keterangan<input id="beaOpsDescription" maxlength="220" required placeholder="Contoh: Gaji Agustus - Rika" /></label>
            <div class="admin-grid two compact">
              <label class="admin-field">Nominal (Rp)<input id="beaOpsAmount" type="number" min="0" step="1" required /></label>
              <label class="admin-field">Tanggal dibebankan<input id="beaOpsDate" type="date" required /><span class="field-note">boleh mundur, mis. gaji bulan lalu</span></label>
            </div>
            <label class="admin-field">Catatan <span class="field-note">opsional</span><input id="beaOpsNote" maxlength="500" /></label>
            <button class="primary-btn" type="submit">Simpan Bea</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><div><h2>Bea yang sudah dicatat</h2><div class="muted">Koreksi lewat Batalkan, bukan hapus — jejaknya tetap tersimpan.</div></div><span id="beaOpsCount" class="master-count">0</span></div>
            <div id="beaOpsList" class="master-list"></div>
          </div>
        </div>
      </section>`);

    document.getElementById('beaOpsForm').addEventListener('submit', save);
  }

  function renderCategoryOptions() {
    const select = el('beaOpsCategory');
    const selected = select.value;
    select.innerHTML = snapshot.categories
      .map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join('');
    if (snapshot.categories.some(item => item.code === selected)) select.value = selected;
  }

  function renderList() {
    el('beaOpsCount').textContent = snapshot.expenses.length;
    el('beaOpsList').innerHTML = snapshot.expenses.length ? snapshot.expenses.map(item => `
      <article class="master-row ${item.voidedAt ? 'inactive' : ''}">
        <div class="master-main">
          <strong>${escapeHtml(item.categoryLabel)} · ${rupiah(item.amount)}</strong>
          <span>${escapeHtml(item.businessDate)} · ${escapeHtml(item.description)}</span>
          <small>${item.voidedAt ? `Dibatalkan${item.voidReason ? ` · ${escapeHtml(item.voidReason)}` : ''}` : escapeHtml(item.note || 'Aktif')}</small>
        </div>
        ${item.voidedAt ? '' : `<button class="text-btn" type="button" data-void-bea="${escapeHtml(item.id)}">Batalkan</button>`}
      </article>`).join('') : '<div class="empty">Belum ada Bea Operasional dicatat.</div>';

    document.querySelectorAll('[data-void-bea]').forEach(button => {
      button.onclick = () => voidExpense(button.dataset.voidBea);
    });
  }

  async function load() {
    snapshot = await api('/api/admin/operational-expenses');
    renderCategoryOptions();
    renderList();
    const dateInput = el('beaOpsDate');
    if (dateInput && !dateInput.value) dateInput.value = snapshot.today || '';
  }

  async function save(event) {
    event.preventDefault();
    try {
      const payload = await api('/api/admin/operational-expenses', {
        method: 'POST',
        body: JSON.stringify({
          category: el('beaOpsCategory').value,
          description: el('beaOpsDescription').value,
          amount: Number(el('beaOpsAmount').value),
          businessDate: el('beaOpsDate').value,
          note: el('beaOpsNote').value
        })
      });
      snapshot.expenses = payload.expenses || snapshot.expenses;
      renderList();
      el('beaOpsDescription').value = '';
      el('beaOpsAmount').value = '';
      el('beaOpsNote').value = '';
      toast('Bea tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function voidExpense(id) {
    if (!confirm('Batalkan bea ini? Angkanya berhenti mengurangi untung di laporan.')) return;
    try {
      const payload = await api(`/api/admin/operational-expenses/${encodeURIComponent(id)}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: '' })
      });
      snapshot.expenses = payload.expenses || snapshot.expenses;
      renderList();
      toast('Bea dibatalkan');
    } catch (error) { toast(error.message); }
  }

  mount();
})();
