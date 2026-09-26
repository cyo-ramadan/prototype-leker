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
  let snapshot = { expenses: [], categories: [], employees: [], today: '', hutangGaji: [], hutangLapakLainnya: [] };

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
            <label class="admin-field hidden" id="beaOpsEmployeeField">Karyawan <span class="field-note">wajib untuk Bea Gaji -- supaya masuk Riwayat Gaji orang itu</span><select id="beaOpsEmployee"></select></label>
            <label class="admin-field hidden" id="beaOpsCounterpartyField">Pihak <span class="field-note">opsional -- nama pemilik lapak/vendor, biar kelihatan di daftar Hutang</span><input id="beaOpsCounterparty" maxlength="200" placeholder="Contoh: Pak RT (lapak), Indihome" /></label>
            <label class="admin-field">Keterangan<input id="beaOpsDescription" maxlength="220" required placeholder="Contoh: Gaji Agustus - Rika" /></label>
            <div class="admin-grid two compact">
              <label class="admin-field">Nominal (Rp)<input id="beaOpsAmount" type="number" step="1" required /><span id="beaOpsAmountNote" class="field-note"></span></label>
              <label class="admin-field">Tanggal dibebankan<input id="beaOpsDate" type="date" required /><span class="field-note">boleh mundur, mis. gaji bulan lalu</span></label>
            </div>
            <label class="admin-field">Catatan <span class="field-note">opsional</span><input id="beaOpsNote" maxlength="500" /></label>
            <button class="primary-btn" type="submit">Simpan Bea</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><div><h2>Bea yang sudah dicatat</h2><div class="muted">Koreksi lewat Batalkan, bukan hapus — jejaknya tetap tersimpan.</div></div><span id="beaOpsCount" class="master-count">0</span></div>
            <div id="beaOpsList" class="master-list"></div>
            <div class="list-head" style="margin-top:20px"><div><h2>Hutang</h2><div class="muted">Gaji, Lapak, dan Lainnya yang belum lunas -- digabung jadi satu daftar walau sumbernya beda.</div></div><span id="hutangCount" class="master-count">0</span></div>
            <div id="hutangList" class="master-list"></div>
          </div>
        </div>
      </section>`);

    document.getElementById('beaOpsForm').addEventListener('submit', save);
    el('beaOpsCategory').addEventListener('change', syncCategoryFields);
  }

  function renderCategoryOptions() {
    const select = el('beaOpsCategory');
    const selected = select.value;
    select.innerHTML = snapshot.categories
      .map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join('');
    if (snapshot.categories.some(item => item.code === selected)) select.value = selected;
    el('beaOpsEmployee').innerHTML = snapshot.employees
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.fullName)}</option>`).join('');
    syncCategoryFields();
  }

  // Bos Cyo, 2026-09-24: Bea Gaji wajib menunjuk Karyawan (supaya masuk Akun
  // Gaji per orang) dan satu-satunya kategori yang boleh nominal negatif
  // (potongan/pinalti gaji) -- dua kategori lain tetap seperti semula.
  //
  // Bos Cyo, 2026-09-26: Bea Lapak/Bea Lainnya sekarang otomatis jadi Hutang
  // begitu disimpan (lihat daftar Hutang di bawah) -- field "Pihak" cuma buat
  // label di daftar itu, bukan syarat wajib.
  function syncCategoryFields() {
    const category = el('beaOpsCategory').value;
    const isBeaGaji = category === 'BEA_GAJI';
    const isHutangCategory = category === 'BEA_LAPAK' || category === 'BEA_LAINNYA';
    el('beaOpsEmployeeField').classList.toggle('hidden', !isBeaGaji);
    el('beaOpsEmployee').required = isBeaGaji;
    el('beaOpsCounterpartyField').classList.toggle('hidden', !isHutangCategory);
    el('beaOpsAmountNote').textContent = isBeaGaji
      ? 'boleh negatif = potongan/pinalti gaji'
      : (isHutangCategory ? 'otomatis jadi Hutang, lunasi dari daftar Hutang di bawah' : '');
  }

  function renderList() {
    el('beaOpsCount').textContent = snapshot.expenses.length;
    el('beaOpsList').innerHTML = snapshot.expenses.length ? snapshot.expenses.map(item => `
      <article class="master-row ${item.voidedAt ? 'inactive' : ''}">
        <div class="master-main">
          <strong>${escapeHtml(item.categoryLabel)}${item.employeeName ? ` · ${escapeHtml(item.employeeName)}` : ''} · ${rupiah(item.amount)}</strong>
          <span>${escapeHtml(item.businessDate)} · ${escapeHtml(item.description)}</span>
          <small>${item.voidedAt ? `Dibatalkan${item.voidReason ? ` · ${escapeHtml(item.voidReason)}` : ''}` : escapeHtml(item.note || 'Aktif')}</small>
        </div>
        ${item.voidedAt ? '' : `<button class="text-btn" type="button" data-void-bea="${escapeHtml(item.id)}">Batalkan</button>`}
      </article>`).join('') : '<div class="empty">Belum ada Bea Operasional dicatat.</div>';

    document.querySelectorAll('[data-void-bea]').forEach(button => {
      button.onclick = () => voidExpense(button.dataset.voidBea);
    });
  }

  const HUTANG_SOURCE_LABEL = { BEA_LAPAK: 'Lapak', BEA_LAINNYA: 'Lainnya' };

  // Bos Cyo, 2026-09-26: "satu program 2 cara kerja bikin bingung" -- admin
  // tidak perlu tahu Hutang Gaji dan Hutang Lapak/Lainnya datang dari dua
  // sumber beda di server (payroll-ledger.js vs operational-expense-
  // payables.js); di sini digabung jadi satu daftar. Baris Gaji tidak punya
  // tombol Bayar di sini -- pelunasannya tetap lewat form di atas (kategori
  // Bea Gaji, nominal negatif), konsisten dengan Riwayat Gaji per orang.
  function renderHutang() {
    const gajiRows = (snapshot.hutangGaji || []).map(item => `
      <article class="master-row">
        <div class="master-main">
          <strong>Gaji · ${escapeHtml(item.employeeName)} · ${rupiah(item.balanceRupiah)}</strong>
          <small>Lunasi lewat form di atas (kategori Bea Gaji, nominal negatif)</small>
        </div>
      </article>`);
    const lapakRows = (snapshot.hutangLapakLainnya || []).map(item => `
      <article class="master-row" data-hutang-row="${escapeHtml(item.id)}">
        <div class="master-main">
          <strong>${escapeHtml(HUTANG_SOURCE_LABEL[item.sourceType] || item.sourceType)} · ${escapeHtml(item.counterpartyName)} · ${rupiah(item.balanceRupiah)}</strong>
          <span>${escapeHtml(item.transactionDate)} · ${escapeHtml(item.description)}</span>
          <small>${item.paidAmountRupiah ? `Sudah dibayar ${rupiah(item.paidAmountRupiah)} dari ${rupiah(item.originalAmountRupiah)}` : 'Belum dibayar sama sekali'}</small>
        </div>
        <button class="text-btn" type="button" data-pay-hutang="${escapeHtml(item.id)}" data-pay-hutang-balance="${item.balanceRupiah}">Bayar</button>
      </article>`);
    const rows = [...gajiRows, ...lapakRows];
    el('hutangCount').textContent = rows.length;
    el('hutangList').innerHTML = rows.length ? rows.join('') : '<div class="empty">Tidak ada Hutang terbuka.</div>';

    document.querySelectorAll('[data-pay-hutang]').forEach(button => {
      button.onclick = () => payHutang(button.dataset.payHutang, Number(button.dataset.payHutangBalance));
    });
  }

  async function load() {
    snapshot = await api('/api/admin/operational-expenses');
    renderCategoryOptions();
    renderList();
    renderHutang();
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
          employeeId: el('beaOpsCategory').value === 'BEA_GAJI' ? el('beaOpsEmployee').value : undefined,
          counterpartyName: el('beaOpsCounterparty').value,
          description: el('beaOpsDescription').value,
          amount: Number(el('beaOpsAmount').value),
          businessDate: el('beaOpsDate').value,
          note: el('beaOpsNote').value
        })
      });
      snapshot.expenses = payload.expenses || snapshot.expenses;
      snapshot.hutangGaji = payload.hutangGaji || snapshot.hutangGaji;
      snapshot.hutangLapakLainnya = payload.hutangLapakLainnya || snapshot.hutangLapakLainnya;
      renderList();
      renderHutang();
      el('beaOpsDescription').value = '';
      el('beaOpsAmount').value = '';
      el('beaOpsNote').value = '';
      el('beaOpsCounterparty').value = '';
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
      snapshot.hutangGaji = payload.hutangGaji || snapshot.hutangGaji;
      snapshot.hutangLapakLainnya = payload.hutangLapakLainnya || snapshot.hutangLapakLainnya;
      renderList();
      renderHutang();
      toast('Bea dibatalkan');
    } catch (error) { toast(error.message); }
  }

  async function payHutang(id, balanceRupiah) {
    const input = prompt(`Bayar berapa? (sisa Hutang ${rupiah(balanceRupiah)})`, String(balanceRupiah));
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isInteger(amount) || amount <= 0) { toast('Nominal bayar harus bilangan bulat rupiah lebih dari nol.'); return; }
    try {
      const payload = await api(`/api/admin/operational-expenses/payables/${encodeURIComponent(id)}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount })
      });
      snapshot.hutangLapakLainnya = payload.hutangLapakLainnya || snapshot.hutangLapakLainnya;
      renderHutang();
      toast('Pembayaran Hutang tersimpan');
    } catch (error) { toast(error.message); }
  }

  mount();
})();
