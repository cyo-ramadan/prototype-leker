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
  let snapshot = { expenses: [], categories: [], employees: [], suppliers: [], today: '' };

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
            <div class="form-title-row"><h2>Catat Hutang &amp; Beban</h2></div>
            <div class="muted" style="margin-bottom:10px">Tombol ini khusus MEMBUAT Hutang + mengakui Beban-nya (langsung mengurangi untung di Laporan). Melunasinya lewat tab <b>Hutang &amp; Pembayaran</b> &rarr; Pembayaran Hutang/Piutang. Beban yang langsung dibayar tanpa hutang: tab yang sama &rarr; Pembayaran Lainnya.</div>
            <label class="admin-field">Jenis bea<select id="beaOpsCategory" required></select></label>
            <label class="admin-field hidden" id="beaOpsEmployeeField">Karyawan <span class="field-note">wajib untuk Bea Gaji -- masuk Hutang Gaji &amp; Riwayat Gaji orang itu</span><select id="beaOpsEmployee"></select></label>
            <div id="beaOpsPartyField" class="hidden">
              <label class="admin-field">Hutang ke <span class="field-note">siapa yang nanti dibayar</span><select id="beaOpsPartyType"><option value="SUPPLIER">Supplier</option><option value="EMPLOYEE">Karyawan</option><option value="OTHER">Lainnya (tulis nama)</option></select></label>
              <label class="admin-field" id="beaOpsSupplierField">Supplier<select id="beaOpsSupplier"></select><span class="field-note">daftar dari Master Supplier gerai ini</span></label>
              <label class="admin-field hidden" id="beaOpsPartyEmployeeField">Karyawan<select id="beaOpsPartyEmployee"></select><span class="field-note">mis. kasbon / talangan di luar gaji rutin</span></label>
              <label class="admin-field hidden" id="beaOpsCounterpartyField">Nama pihak<input id="beaOpsCounterparty" maxlength="200" placeholder="Contoh: Pak RT (pemilik lapak), Indihome" /></label>
            </div>
            <label class="admin-field">Keterangan<input id="beaOpsDescription" maxlength="220" required placeholder="Contoh: Gaji Agustus - Rika" /></label>
            <div class="admin-grid two compact">
              <label class="admin-field">Nominal (Rp)<input id="beaOpsAmount" type="number" step="1" required /><span id="beaOpsAmountNote" class="field-note"></span></label>
              <label class="admin-field">Tanggal dibebankan<input id="beaOpsDate" type="date" required /><span class="field-note">boleh mundur, mis. gaji bulan lalu</span></label>
            </div>
            <label class="admin-field">Catatan <span class="field-note">opsional</span><input id="beaOpsNote" maxlength="500" /></label>
            <button class="primary-btn" type="submit">Simpan Hutang &amp; Beban</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><div><h2>Bea yang sudah dicatat</h2><div class="muted">Koreksi lewat Batalkan, bukan hapus — jejaknya tetap tersimpan.</div></div><span id="beaOpsCount" class="master-count">0</span></div>
            <div id="beaOpsList" class="master-list"></div>
          </div>
        </div>
      </section>`);

    document.getElementById('beaOpsForm').addEventListener('submit', save);
    el('beaOpsCategory').addEventListener('change', syncCategoryFields);
    el('beaOpsPartyType').addEventListener('change', syncCategoryFields);
  }

  function renderCategoryOptions() {
    const select = el('beaOpsCategory');
    const selected = select.value;
    select.innerHTML = snapshot.categories
      .map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join('');
    if (snapshot.categories.some(item => item.code === selected)) select.value = selected;
    const employeeOptions = snapshot.employees
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.fullName)}</option>`).join('');
    el('beaOpsEmployee').innerHTML = employeeOptions;
    el('beaOpsPartyEmployee').innerHTML = employeeOptions;
    el('beaOpsSupplier').innerHTML = (snapshot.suppliers || []).length
      ? snapshot.suppliers.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')
      : '<option value="">Belum ada supplier -- tambah dulu di Master Supplier</option>';
    syncCategoryFields();
  }

  // Bos Cyo, 2026-09-24: Bea Gaji wajib menunjuk Karyawan (Hutang Gaji per
  // orang); nominal minus = potongan/pinalti gaji, BUKAN pembayaran.
  // Bos Cyo, 2026-09-26: Bea Lapak/Lainnya wajib menunjuk pihak yang
  // dihutangi -- Supplier, Karyawan, atau nama bebas.
  function syncCategoryFields() {
    const isBeaGaji = el('beaOpsCategory').value === 'BEA_GAJI';
    const partyType = el('beaOpsPartyType').value;
    el('beaOpsEmployeeField').classList.toggle('hidden', !isBeaGaji);
    el('beaOpsEmployee').required = isBeaGaji;
    el('beaOpsPartyField').classList.toggle('hidden', isBeaGaji);
    el('beaOpsSupplierField').classList.toggle('hidden', isBeaGaji || partyType !== 'SUPPLIER');
    el('beaOpsPartyEmployeeField').classList.toggle('hidden', isBeaGaji || partyType !== 'EMPLOYEE');
    el('beaOpsCounterpartyField').classList.toggle('hidden', isBeaGaji || partyType !== 'OTHER');
    el('beaOpsAmountNote').textContent = isBeaGaji
      ? 'minus = potongan/pinalti gaji (bukan pembayaran)'
      : 'otomatis jadi Hutang ke pihak di atas';
  }

  function partyPayload() {
    if (el('beaOpsCategory').value === 'BEA_GAJI') return {};
    const type = el('beaOpsPartyType').value;
    if (type === 'SUPPLIER') return { counterpartyType: 'SUPPLIER', counterpartyId: el('beaOpsSupplier').value };
    if (type === 'EMPLOYEE') return { counterpartyType: 'EMPLOYEE', counterpartyId: el('beaOpsPartyEmployee').value };
    return { counterpartyType: 'OTHER', counterpartyName: el('beaOpsCounterparty').value };
  }

  function renderList() {
    el('beaOpsCount').textContent = snapshot.expenses.length;
    el('beaOpsList').innerHTML = snapshot.expenses.length ? snapshot.expenses.map(item => {
      const party = item.employeeName || item.counterpartyName;
      const status = item.voidedAt
        ? `Dibatalkan${item.voidReason ? ` · ${escapeHtml(item.voidReason)}` : ''}`
        : (item.settlement === 'HUTANG' ? 'Jadi Hutang' : 'Dibayar langsung');
      const action = item.voidedAt ? ''
        : item.adminPaymentId
          ? '<small class="muted">batalkan dari riwayat Pembayaran</small>'
          : `<button class="text-btn" type="button" data-void-bea="${escapeHtml(item.id)}">Batalkan</button>`;
      return `
      <article class="master-row ${item.voidedAt ? 'inactive' : ''}">
        <div class="master-main">
          <strong>${escapeHtml(item.categoryLabel)}${party ? ` · ${escapeHtml(party)}` : ''} · ${rupiah(item.amount)}</strong>
          <span>${escapeHtml(item.businessDate)} · ${escapeHtml(item.description)}</span>
          <small>${status}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small>
        </div>
        ${action}
      </article>`;
    }).join('') : '<div class="empty">Belum ada Bea Operasional dicatat.</div>';

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
          employeeId: el('beaOpsCategory').value === 'BEA_GAJI' ? el('beaOpsEmployee').value : undefined,
          ...partyPayload(),
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
      el('beaOpsCounterparty').value = '';
      toast('Hutang & Beban tersimpan -- lunasi lewat tab Hutang & Pembayaran');
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
