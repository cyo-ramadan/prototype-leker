(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const state = {
    accounting: null,
    warehouse: null,
    selectedTransactionCategoryId: '',
    editingAccountId: '',
    editingPaymentMethodId: '',
    editingItemCategoryId: '',
    editingRuleId: '',
    selectedWarehouseId: ''
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function injectStyle() {
    if (el('adminSettingsStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminSettingsStyle';
    style.textContent = `
      .settings-grid{display:grid;grid-template-columns:minmax(240px,.75fr) minmax(0,1.8fr);gap:14px;align-items:start}
      .settings-stack{display:grid;gap:12px}.settings-row{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      .settings-list{display:grid;gap:8px;margin-top:10px}.settings-item{border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff}
      .settings-item.active-select{outline:2px solid #111}.settings-meta{font-size:12px;color:#6e655d;margin-top:3px;line-height:1.45}
      .settings-chip{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:900;background:#f1eee9}.settings-chip.complete{background:#e6f7ec;color:#1a6b38}.settings-chip.incomplete{background:#fff1d6;color:#8b5d00}.settings-chip.review{background:#ffe7e7;color:#9a2727}
      .settings-subnav{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.settings-subnav button.active{background:#111;color:#fff}
      .settings-form-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.settings-preview{display:grid;gap:7px;margin-top:10px}.settings-preview-line{display:grid;grid-template-columns:70px 1fr;gap:8px;padding:8px;border-radius:10px;background:#f8f5f1}.settings-preview-line b{font-size:12px}
      .settings-checkbox-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.settings-checkbox-grid label{font-size:13px}
      .settings-warning{padding:10px 12px;border:1px dashed #d3a74a;background:#fff8e8;border-radius:12px;font-size:13px}
      @media(max-width:800px){.settings-grid{grid-template-columns:1fr}.settings-checkbox-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function removeLegacyAccountingPortal() {
    el('accountingReferenceTab')?.remove();
    el('tab-accounting-reference')?.remove();
  }

  function mountPanels() {
    const tabs = document.querySelector('.admin-tabs');
    const toastNode = el('adminToast');
    if (!tabs || !toastNode || el('accountingSettingsTab')) return;
    removeLegacyAccountingPortal();

    const accountingButton = document.createElement('button');
    accountingButton.id = 'accountingSettingsTab';
    accountingButton.className = 'admin-tab';
    accountingButton.type = 'button';
    accountingButton.textContent = 'Accounting Settings';
    tabs.appendChild(accountingButton);

    const warehouseButton = document.createElement('button');
    warehouseButton.id = 'warehouseSettingsTab';
    warehouseButton.className = 'admin-tab';
    warehouseButton.type = 'button';
    warehouseButton.textContent = 'Warehouse Settings';
    tabs.appendChild(warehouseButton);

    toastNode.insertAdjacentHTML('beforebegin', accountingPanelHtml() + warehousePanelHtml());

    accountingButton.addEventListener('click', () => activatePanel('tab-accounting-settings', accountingButton, () => loadAccounting(true)));
    warehouseButton.addEventListener('click', () => activatePanel('tab-warehouse-settings', warehouseButton, () => loadWarehouse(true)));
    bindAccountingEvents();
    bindWarehouseEvents();
  }

  function activatePanel(sectionId, button, loader) {
    document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === sectionId));
    loader().catch(error => toast(error.message));
  }

  function accountingPanelHtml() {
    return `
      <section id="tab-accounting-settings" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><div class="admin-eyebrow">Module A</div><h2>Accounting Settings</h2><div class="muted">Konfigurasi akun dan journal rules. Panel ini tidak melakukan journal posting otomatis.</div></div><button id="accountingSettingsRefresh" class="secondary-btn" type="button">↻ Refresh</button></div>
          <div class="settings-warning" style="margin-top:12px"><b>Boundary:</b> business transaction hanya membaca konfigurasi. Journal-generation engine tetap task terpisah setelah rule direview.</div>
        </div>
        <div class="settings-subnav" style="margin-top:14px">
          <button class="secondary-btn active" type="button" data-accounting-section="coa">Chart of Accounts</button>
          <button class="secondary-btn" type="button" data-accounting-section="payment">Payment Methods</button>
          <button class="secondary-btn" type="button" data-accounting-section="item">Item Categories</button>
          <button class="secondary-btn" type="button" data-accounting-section="rules">Transaction & Journal Rules</button>
        </div>

        <div id="accountingSectionCoa" data-accounting-panel="coa" class="settings-grid">
          <form id="accountForm" class="admin-card">
            <input id="accountId" type="hidden" />
            <h2 id="accountFormTitle">Tambah Akun</h2>
            <label class="admin-field">Kode<input id="accountCode" maxlength="24" required /></label>
            <label class="admin-field">Nama<input id="accountName" maxlength="100" required /></label>
            <label class="admin-field">Tipe<select id="accountType"><option>ASSET</option><option>LIABILITY</option><option>EQUITY</option><option>REVENUE</option><option>EXPENSE</option></select></label>
            <label class="admin-field">Subtype<input id="accountSubtype" maxlength="60" placeholder="optional" /></label>
            <label class="admin-check"><input id="accountActive" type="checkbox" checked /> Aktif</label>
            <label class="admin-check"><input id="accountReviewRequired" type="checkbox" /> Perlu review pemilik bisnis</label>
            <div class="settings-form-actions"><button class="primary-btn" type="submit">Simpan Akun</button><button id="accountCancelEdit" class="secondary-btn hidden" type="button">Batal Edit</button></div>
          </form>
          <div class="admin-card"><div class="list-head"><h2>Chart of Accounts</h2><span id="accountCount" class="master-count">0</span></div><div id="accountList" class="settings-list"></div></div>
        </div>

        <div id="accountingSectionPayment" data-accounting-panel="payment" class="settings-grid hidden">
          <form id="paymentMethodForm" class="admin-card">
            <input id="paymentMethodId" type="hidden" />
            <h2 id="paymentMethodFormTitle">Tambah Payment Method</h2>
            <label class="admin-field">Nama<input id="paymentMethodName" maxlength="80" required /></label>
            <label class="admin-field">Akun terkait<select id="paymentMethodAccount"></select></label>
            <label class="admin-check"><input id="paymentMethodActive" type="checkbox" checked /> Aktif</label>
            <div class="settings-form-actions"><button class="primary-btn" type="submit">Simpan</button><button id="paymentMethodCancel" class="secondary-btn hidden" type="button">Batal Edit</button></div>
          </form>
          <div class="admin-card"><div class="list-head"><h2>Payment Methods</h2><span id="paymentMethodCount" class="master-count">0</span></div><div id="paymentMethodList" class="settings-list"></div></div>
        </div>

        <div id="accountingSectionItem" data-accounting-panel="item" class="settings-grid hidden">
          <form id="itemCategoryForm" class="admin-card">
            <input id="itemCategoryId" type="hidden" />
            <h2 id="itemCategoryFormTitle">Link Jenis Barang</h2>
            <label class="admin-field">Jenis Barang<select id="itemCategoryProductKind" required></select></label>
            <label class="admin-field">Nama mapping<input id="itemCategoryName" maxlength="100" placeholder="Default nama Jenis Barang" /></label>
            <label class="admin-field">Akun Persediaan<select id="itemCategoryInventory" required></select></label>
            <label class="admin-field">Akun HPP<select id="itemCategoryCogs" required></select></label>
            <label class="admin-field">Akun Penjualan <span class="field-note">nullable</span><select id="itemCategoryRevenue"></select></label>
            <label class="admin-check"><input id="itemCategoryActive" type="checkbox" checked /> Aktif</label>
            <div class="settings-form-actions"><button class="primary-btn" type="submit">Simpan Mapping</button><button id="itemCategoryCancel" class="secondary-btn hidden" type="button">Batal Edit</button></div>
          </form>
          <div class="admin-card"><div class="list-head"><h2>Item Categories</h2><span id="itemCategoryCount" class="master-count">0</span></div><div class="muted">Satu Jenis Barang → akun Persediaan/HPP/Penjualan.</div><div id="itemCategoryList" class="settings-list"></div></div>
        </div>

        <div id="accountingSectionRules" data-accounting-panel="rules" class="settings-grid hidden">
          <div class="settings-stack">
            <form id="transactionCategoryForm" class="admin-card">
              <h2>Tambah Kategori Transaksi</h2>
              <label class="admin-field">Kode<input id="transactionCategoryCode" maxlength="40" placeholder="contoh: refund_customer" required /></label>
              <label class="admin-field">Nama<input id="transactionCategoryName" maxlength="100" required /></label>
              <label class="admin-field">Deskripsi<textarea id="transactionCategoryDescription" rows="2" maxlength="500"></textarea></label>
              <label class="admin-check"><input id="transactionCategoryPayment" type="checkbox" /> Melibatkan payment method</label>
              <label class="admin-check"><input id="transactionCategoryItem" type="checkbox" /> Melibatkan item category</label>
              <button class="primary-btn" type="submit">＋ Tambah Kategori</button>
            </form>
            <div class="admin-card"><div class="list-head"><h2>Kategori Transaksi</h2><span id="transactionCategoryCount" class="master-count">0</span></div><div id="transactionCategoryList" class="settings-list"></div></div>
          </div>
          <div class="settings-stack">
            <div id="journalRuleEditor" class="admin-card"><div class="empty">Pilih kategori transaksi di kiri.</div></div>
            <form id="journalRuleForm" class="admin-card hidden">
              <input id="journalRuleId" type="hidden" />
              <h2 id="journalRuleFormTitle">Tambah Baris Debit/Kredit</h2>
              <label class="admin-field">Label<input id="journalRuleLabel" maxlength="140" required /></label>
              <div class="admin-grid two compact"><label class="admin-field">Side<select id="journalRuleSide"><option>DEBIT</option><option>CREDIT</option></select></label><label class="admin-field">Source<select id="journalRuleSource"></select></label></div>
              <label id="journalRuleFixedWrap" class="admin-field hidden">Fixed Account<select id="journalRuleFixedAccount"></select></label>
              <label class="admin-field">Sort Order<input id="journalRuleSort" type="number" step="1" value="10" /></label>
              <label class="admin-check"><input id="journalRuleActive" type="checkbox" checked /> Aktif</label>
              <div class="settings-form-actions"><button class="primary-btn" type="submit">Simpan Baris</button><button id="journalRuleCancel" class="secondary-btn hidden" type="button">Batal Edit</button></div>
            </form>
          </div>
        </div>
      </section>`;
  }

  function warehousePanelHtml() {
    return `
      <section id="tab-warehouse-settings" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><div class="admin-eyebrow">Module B</div><h2>Warehouse Settings</h2><div class="muted">Gudang, akses, dan parameter stock opname. Tidak ada account mapping di modul ini.</div></div><button id="warehouseSettingsRefresh" class="secondary-btn" type="button">↻ Refresh</button></div>
          <div class="settings-warning" style="margin-top:12px">Transaksi warehouse bernilai uang didaftarkan ke <b>Accounting Settings → Transaction Categories</b> melalui data. Warehouse tidak memiliki tabel account mapping sendiri.</div>
        </div>
        <div class="settings-grid" style="margin-top:14px">
          <div class="settings-stack">
            <form id="warehouseForm" class="admin-card">
              <input id="warehouseId" type="hidden" />
              <h2 id="warehouseFormTitle">Tambah Gudang / Lokasi</h2>
              <label class="admin-field">Kode<input id="warehouseCode" maxlength="32" required /></label>
              <label class="admin-field">Nama<input id="warehouseName" maxlength="100" required /></label>
              <label class="admin-field">Lokasi<input id="warehouseLocation" maxlength="140" /></label>
              <label class="admin-check"><input id="warehouseActive" type="checkbox" checked /> Aktif</label>
              <div class="settings-form-actions"><button class="primary-btn" type="submit">Simpan Gudang</button><button id="warehouseCancel" class="secondary-btn hidden" type="button">Batal Edit</button></div>
            </form>
            <div class="admin-card"><div class="list-head"><h2>Daftar Gudang</h2><span id="warehouseCount" class="master-count">0</span></div><div id="warehouseList" class="settings-list"></div></div>
          </div>
          <div class="settings-stack">
            <form id="warehouseAccessForm" class="admin-card hidden">
              <h2>Hak Akses Gudang</h2>
              <div id="warehouseAccessTitle" class="muted"></div>
              <label class="admin-field">Admin / Kasir<select id="warehousePrincipal"></select></label>
              <div class="settings-checkbox-grid">
                <label><input id="warehouseCanOpname" type="checkbox" /> Stock Opname</label>
                <label><input id="warehouseCanTransfer" type="checkbox" /> Transfer</label>
                <label><input id="warehouseCanReceive" type="checkbox" /> Barang Masuk</label>
                <label><input id="warehouseCanIssue" type="checkbox" /> Barang Keluar</label>
              </div>
              <button class="primary-btn" type="submit" style="margin-top:12px">Simpan Hak Akses</button>
              <div id="warehouseAccessList" class="settings-list"></div>
            </form>
            <form id="warehouseOpnameForm" class="admin-card hidden">
              <h2>Parameter Stock Opname</h2>
              <label class="admin-field">Toleransi Qty<input id="warehouseQtyTolerance" type="number" min="0" step="any" value="0" /></label>
              <label class="admin-field">Toleransi Persentase (%)<input id="warehousePercentTolerance" type="number" min="0" max="100" step="0.01" value="0" /></label>
              <label class="admin-field">Jadwal<select id="warehouseScheduleType"><option>MANUAL</option><option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option></select></label>
              <label id="warehouseScheduleDayWrap" class="admin-field hidden">Hari / Tanggal<input id="warehouseScheduleDay" type="number" min="1" max="31" step="1" /></label>
              <label class="admin-check"><input id="warehouseRequiresApproval" type="checkbox" checked /> Selisih perlu approval</label>
              <button class="primary-btn" type="submit">Simpan Parameter</button>
            </form>
            <div class="admin-card">
              <h2>Registrasi ke Accounting Settings</h2>
              <div class="muted">Read-only dari Module B. Rule akun tetap diedit di Module A.</div>
              <div id="warehouseRegisteredTransactions" class="settings-list"></div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function bindAccountingEvents() {
    el('accountingSettingsRefresh')?.addEventListener('click', () => loadAccounting(true).catch(error => toast(error.message)));
    document.querySelectorAll('[data-accounting-section]').forEach(button => button.addEventListener('click', () => {
      document.querySelectorAll('[data-accounting-section]').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-accounting-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.accountingPanel !== button.dataset.accountingSection));
    }));
    el('accountForm')?.addEventListener('submit', saveAccount);
    el('accountCancelEdit')?.addEventListener('click', resetAccountForm);
    el('paymentMethodForm')?.addEventListener('submit', savePaymentMethod);
    el('paymentMethodCancel')?.addEventListener('click', resetPaymentMethodForm);
    el('itemCategoryForm')?.addEventListener('submit', saveItemCategory);
    el('itemCategoryCancel')?.addEventListener('click', resetItemCategoryForm);
    el('transactionCategoryForm')?.addEventListener('submit', saveTransactionCategory);
    el('journalRuleForm')?.addEventListener('submit', saveJournalRule);
    el('journalRuleCancel')?.addEventListener('click', resetJournalRuleForm);
    el('journalRuleSource')?.addEventListener('change', toggleFixedAccount);
  }

  function bindWarehouseEvents() {
    el('warehouseSettingsRefresh')?.addEventListener('click', () => loadWarehouse(true).catch(error => toast(error.message)));
    el('warehouseForm')?.addEventListener('submit', saveWarehouse);
    el('warehouseCancel')?.addEventListener('click', resetWarehouseForm);
    el('warehouseAccessForm')?.addEventListener('submit', saveWarehouseAccess);
    el('warehouseOpnameForm')?.addEventListener('submit', saveWarehouseOpname);
    el('warehouseScheduleType')?.addEventListener('change', toggleScheduleDay);
  }

  function activeAccounts(type = '') {
    return (state.accounting?.accounts || []).filter(account => account.isActive && (!type || account.type === type));
  }

  function accountOptions(type = '', selected = '', allowBlank = false) {
    return `${allowBlank ? '<option value="">Belum dipilih</option>' : ''}${activeAccounts(type).map(account => `<option value="${esc(account.id)}" ${account.id === selected ? 'selected' : ''}>${esc(account.code)} · ${esc(account.name)}</option>`).join('')}`;
  }

  function renderAccounting() {
    if (!state.accounting) return;
    renderAccounts();
    renderPaymentMethods();
    renderItemCategories();
    renderTransactionCategories();
    const sources = state.accounting.sourceTypes || [];
    if (el('journalRuleSource')) el('journalRuleSource').innerHTML = sources.map(source => `<option value="${esc(source)}">${esc(source)}</option>`).join('');
    if (el('journalRuleFixedAccount')) el('journalRuleFixedAccount').innerHTML = accountOptions('', '', true);
    toggleFixedAccount();
  }

  function renderAccounts() {
    const accounts = state.accounting?.accounts || [];
    el('accountCount').textContent = String(accounts.length);
    el('accountList').innerHTML = accounts.length ? accounts.map(account => `
      <div class="settings-item">
        <div class="settings-row"><div><b>${esc(account.code)} · ${esc(account.name)}</b><div class="settings-meta">${esc(account.type)}${account.subtype ? ` · ${esc(account.subtype)}` : ''} · ${account.isActive ? 'aktif' : 'nonaktif'}</div></div><div>${account.reviewRequired ? '<span class="settings-chip review">REVIEW</span>' : ''} <button class="mini-btn" type="button" data-edit-account="${esc(account.id)}">Edit</button></div></div>
      </div>`).join('') : '<div class="empty">Belum ada akun.</div>';
    document.querySelectorAll('[data-edit-account]').forEach(button => button.addEventListener('click', () => editAccount(button.dataset.editAccount)));
    if (!state.editingPaymentMethodId) el('paymentMethodAccount').innerHTML = accountOptions('', '', true);
    if (!state.editingItemCategoryId) {
      el('itemCategoryInventory').innerHTML = accountOptions('ASSET');
      el('itemCategoryCogs').innerHTML = accountOptions('EXPENSE');
      el('itemCategoryRevenue').innerHTML = accountOptions('REVENUE', '', true);
    }
  }

  function editAccount(id) {
    const account = state.accounting.accounts.find(item => item.id === id);
    if (!account) return;
    state.editingAccountId = id;
    el('accountId').value = id;
    el('accountCode').value = account.code;
    el('accountCode').disabled = true;
    el('accountType').value = account.type;
    el('accountType').disabled = true;
    el('accountName').value = account.name;
    el('accountSubtype').value = account.subtype || '';
    el('accountActive').checked = account.isActive;
    el('accountReviewRequired').checked = account.reviewRequired;
    el('accountFormTitle').textContent = 'Edit Akun';
    el('accountCancelEdit').classList.remove('hidden');
  }

  function resetAccountForm() {
    state.editingAccountId = '';
    el('accountForm').reset();
    el('accountId').value = '';
    el('accountCode').disabled = false;
    el('accountType').disabled = false;
    el('accountActive').checked = true;
    el('accountReviewRequired').checked = false;
    el('accountFormTitle').textContent = 'Tambah Akun';
    el('accountCancelEdit').classList.add('hidden');
  }

  async function saveAccount(event) {
    event.preventDefault();
    const id = state.editingAccountId;
    try {
      await api(id ? `/api/admin/settings/accounting/accounts/${encodeURIComponent(id)}` : '/api/admin/settings/accounting/accounts', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          code: el('accountCode').value,
          name: el('accountName').value,
          type: el('accountType').value,
          subtype: el('accountSubtype').value,
          isActive: el('accountActive').checked,
          reviewRequired: el('accountReviewRequired').checked
        })
      });
      resetAccountForm();
      await loadAccounting(true);
      toast('Chart of Accounts tersimpan');
    } catch (error) { toast(error.message); }
  }

  function renderPaymentMethods() {
    const items = state.accounting?.paymentMethods || [];
    el('paymentMethodCount').textContent = String(items.length);
    el('paymentMethodList').innerHTML = items.map(item => `<div class="settings-item"><div class="settings-row"><div><b>${esc(item.name)}</b><div class="settings-meta">${esc(item.code)} · ${item.account ? `${esc(item.account.code)} ${esc(item.account.name)}` : 'akun belum dipilih'} · ${item.isActive ? 'aktif' : 'nonaktif'}</div></div><button class="mini-btn" type="button" data-edit-payment="${esc(item.id)}">Atur</button></div></div>`).join('') || '<div class="empty">Belum ada payment method.</div>';
    document.querySelectorAll('[data-edit-payment]').forEach(button => button.addEventListener('click', () => editPaymentMethod(button.dataset.editPayment)));
    if (!state.editingPaymentMethodId) el('paymentMethodAccount').innerHTML = accountOptions('', '', true);
  }

  function editPaymentMethod(id) {
    const item = state.accounting.paymentMethods.find(row => row.id === id);
    if (!item) return;
    state.editingPaymentMethodId = id;
    el('paymentMethodId').value = id;
    el('paymentMethodName').value = item.name;
    el('paymentMethodAccount').innerHTML = accountOptions('', item.accountId || '', true);
    el('paymentMethodActive').checked = item.isActive;
    el('paymentMethodFormTitle').textContent = `Atur ${item.code}`;
    el('paymentMethodCancel').classList.remove('hidden');
  }

  function resetPaymentMethodForm() {
    state.editingPaymentMethodId = '';
    el('paymentMethodForm').reset();
    el('paymentMethodId').value = '';
    el('paymentMethodActive').checked = true;
    el('paymentMethodAccount').innerHTML = accountOptions('', '', true);
    el('paymentMethodFormTitle').textContent = 'Tambah Payment Method';
    el('paymentMethodCancel').classList.add('hidden');
  }

  async function savePaymentMethod(event) {
    event.preventDefault();
    const id = state.editingPaymentMethodId;
    try {
      await api(id ? `/api/admin/settings/accounting/payment-methods/${encodeURIComponent(id)}` : '/api/admin/settings/accounting/payment-methods', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: el('paymentMethodName').value, accountId: el('paymentMethodAccount').value || null, isActive: el('paymentMethodActive').checked })
      });
      resetPaymentMethodForm();
      await loadAccounting(true);
      toast('Payment Method tersimpan');
    } catch (error) { toast(error.message); }
  }

  function renderItemCategories() {
    const items = state.accounting?.itemCategories || [];
    const kinds = (state.accounting?.productKinds || []).filter(kind => kind.isActive);
    el('itemCategoryCount').textContent = String(items.length);
    if (!state.editingItemCategoryId) el('itemCategoryProductKind').innerHTML = kinds.map(kind => `<option value="${esc(kind.id)}">${esc(kind.name)} · ${esc(kind.code)}</option>`).join('');
    el('itemCategoryList').innerHTML = items.map(item => `<div class="settings-item"><div class="settings-row"><div><b>${esc(item.name)}</b><div class="settings-meta">Jenis ${esc(item.productKindName)} · Persediaan ${esc(item.inventoryAccount.code)} · HPP ${esc(item.cogsAccount.code)}${item.revenueAccount ? ` · Penjualan ${esc(item.revenueAccount.code)}` : ''}</div></div><button class="mini-btn" type="button" data-edit-item-category="${esc(item.id)}">Atur</button></div></div>`).join('') || '<div class="empty">Belum ada Jenis Barang yang dilink ke akun.</div>';
    document.querySelectorAll('[data-edit-item-category]').forEach(button => button.addEventListener('click', () => editItemCategory(button.dataset.editItemCategory)));
  }

  function editItemCategory(id) {
    const item = state.accounting.itemCategories.find(row => row.id === id);
    if (!item) return;
    state.editingItemCategoryId = id;
    el('itemCategoryId').value = id;
    el('itemCategoryProductKind').innerHTML = (state.accounting.productKinds || []).map(kind => `<option value="${esc(kind.id)}">${esc(kind.name)} · ${esc(kind.code)}</option>`).join('');
    el('itemCategoryProductKind').value = item.productKindId;
    el('itemCategoryName').value = item.name;
    el('itemCategoryInventory').innerHTML = accountOptions('ASSET', item.inventoryAccountId);
    el('itemCategoryCogs').innerHTML = accountOptions('EXPENSE', item.cogsAccountId);
    el('itemCategoryRevenue').innerHTML = accountOptions('REVENUE', item.revenueAccountId || '', true);
    el('itemCategoryActive').checked = item.isActive;
    el('itemCategoryFormTitle').textContent = 'Edit Item Category';
    el('itemCategoryCancel').classList.remove('hidden');
  }

  function resetItemCategoryForm() {
    state.editingItemCategoryId = '';
    el('itemCategoryForm').reset();
    el('itemCategoryId').value = '';
    el('itemCategoryActive').checked = true;
    renderItemCategories();
    renderAccounts();
    el('itemCategoryFormTitle').textContent = 'Link Jenis Barang';
    el('itemCategoryCancel').classList.add('hidden');
  }

  async function saveItemCategory(event) {
    event.preventDefault();
    const id = state.editingItemCategoryId;
    try {
      await api(id ? `/api/admin/settings/accounting/item-categories/${encodeURIComponent(id)}` : '/api/admin/settings/accounting/item-categories', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          productKindId: el('itemCategoryProductKind').value,
          name: el('itemCategoryName').value,
          inventoryAccountId: el('itemCategoryInventory').value,
          cogsAccountId: el('itemCategoryCogs').value,
          revenueAccountId: el('itemCategoryRevenue').value || null,
          isActive: el('itemCategoryActive').checked
        })
      });
      resetItemCategoryForm();
      await loadAccounting(true);
      toast('Item Category tersimpan');
    } catch (error) { toast(error.message); }
  }

  function renderTransactionCategories() {
    const categories = state.accounting?.transactionCategories || [];
    if (!categories.some(item => item.id === state.selectedTransactionCategoryId)) state.selectedTransactionCategoryId = categories[0]?.id || '';
    el('transactionCategoryCount').textContent = String(categories.length);
    el('transactionCategoryList').innerHTML = categories.map(category => `<button type="button" class="settings-item ${category.id === state.selectedTransactionCategoryId ? 'active-select' : ''}" data-select-tx-category="${esc(category.id)}" style="text-align:left;width:100%;cursor:pointer"><div class="settings-row"><b>${esc(category.name)}</b><span class="settings-chip ${category.completeness === 'COMPLETE' ? 'complete' : 'incomplete'}">${category.completeness === 'COMPLETE' ? 'Lengkap' : 'Belum Lengkap'}</span></div><div class="settings-meta">${esc(category.code)} · ${esc(category.registeredByModule)} · D${category.debitCount}/K${category.creditCount}</div></button>`).join('') || '<div class="empty">Belum ada kategori transaksi.</div>';
    document.querySelectorAll('[data-select-tx-category]').forEach(button => button.addEventListener('click', () => {
      state.selectedTransactionCategoryId = button.dataset.selectTxCategory;
      resetJournalRuleForm();
      renderTransactionCategories();
    }));
    renderJournalEditor();
  }

  function selectedCategory() {
    return (state.accounting?.transactionCategories || []).find(item => item.id === state.selectedTransactionCategoryId) || null;
  }

  function sourceLabel(rule) {
    if (rule.sourceType === 'fixed_account') return rule.fixedAccount ? `${rule.fixedAccount.code} · ${rule.fixedAccount.name}` : 'Fixed account belum valid';
    const labels = {
      payment_method: 'Akun dari Payment Method',
      item_category_inventory: 'Akun Persediaan dari Item Category',
      item_category_cogs: 'Akun HPP dari Item Category',
      item_category_revenue: 'Akun Penjualan dari Item Category',
      cost_center_cash: 'Kas Cost Center'
    };
    return labels[rule.sourceType] || rule.sourceType;
  }

  function renderJournalEditor() {
    const category = selectedCategory();
    const host = el('journalRuleEditor');
    const form = el('journalRuleForm');
    if (!category) {
      host.innerHTML = '<div class="empty">Pilih kategori transaksi di kiri.</div>';
      form.classList.add('hidden');
      return;
    }
    const rules = category.rules || [];
    host.innerHTML = `
      <div class="settings-row"><div><div class="admin-eyebrow">${esc(category.registeredByModule)}</div><h2>${esc(category.name)}</h2><div class="muted">${esc(category.description)}</div></div><span class="settings-chip ${category.completeness === 'COMPLETE' ? 'complete' : 'incomplete'}">${category.completeness === 'COMPLETE' ? 'Lengkap' : 'Belum Lengkap'}</span></div>
      <div class="settings-meta" style="margin-top:8px">${category.involvesPayment ? '✓ payment method' : '— payment method'} · ${category.involvesItemCategory ? '✓ item category' : '— item category'}</div>
      ${(category.blockers || []).length ? `<div class="settings-list" style="margin-top:8px">${category.blockers.map(blocker => `<div class="settings-item"><div class="settings-meta">▲ ${esc(blocker.detail)}</div></div>`).join('')}</div>` : ''}
      <div class="settings-list">${rules.map(rule => `<div class="settings-item"><div class="settings-row"><div><b>${esc(rule.side)} · ${esc(rule.label)}</b><div class="settings-meta">${esc(sourceLabel(rule))} · sort ${rule.sortOrder} · ${rule.isActive ? 'aktif' : 'nonaktif'}</div></div><button class="mini-btn" type="button" data-edit-rule="${esc(rule.id)}">Edit</button></div></div>`).join('') || '<div class="empty">Belum ada baris debit/kredit.</div>'}</div>
      <h3 style="margin-top:16px">Pratinjau Jurnal</h3>
      <div class="settings-preview">${rules.filter(rule => rule.isActive).map(rule => `<div class="settings-preview-line"><b>${esc(rule.side)}</b><span>${esc(rule.label)} ← ${esc(sourceLabel(rule))}</span></div>`).join('') || '<div class="muted">Tambahkan minimal 1 Debit + 1 Kredit untuk membuat kategori Lengkap.</div>'}</div>`;
    host.querySelectorAll('[data-edit-rule]').forEach(button => button.addEventListener('click', () => editJournalRule(button.dataset.editRule)));
    form.classList.remove('hidden');
  }

  async function saveTransactionCategory(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/settings/accounting/transaction-categories', {
        method: 'POST',
        body: JSON.stringify({ code: el('transactionCategoryCode').value, name: el('transactionCategoryName').value, description: el('transactionCategoryDescription').value, involvesPayment: el('transactionCategoryPayment').checked, involvesItemCategory: el('transactionCategoryItem').checked })
      });
      el('transactionCategoryForm').reset();
      await loadAccounting(true);
      state.selectedTransactionCategoryId = result.id;
      renderTransactionCategories();
      toast('Kategori transaksi ditambahkan');
    } catch (error) { toast(error.message); }
  }

  function toggleFixedAccount() {
    const fixed = el('journalRuleSource')?.value === 'fixed_account';
    el('journalRuleFixedWrap')?.classList.toggle('hidden', !fixed);
  }

  function editJournalRule(id) {
    const category = selectedCategory();
    const rule = category?.rules.find(item => item.id === id);
    if (!rule) return;
    state.editingRuleId = id;
    el('journalRuleId').value = id;
    el('journalRuleLabel').value = rule.label;
    el('journalRuleSide').value = rule.side;
    el('journalRuleSource').value = rule.sourceType;
    el('journalRuleFixedAccount').innerHTML = accountOptions('', rule.fixedAccountId || '', true);
    el('journalRuleSort').value = String(rule.sortOrder);
    el('journalRuleActive').checked = rule.isActive;
    el('journalRuleFormTitle').textContent = 'Edit Baris Debit/Kredit';
    el('journalRuleCancel').classList.remove('hidden');
    toggleFixedAccount();
  }

  function resetJournalRuleForm() {
    state.editingRuleId = '';
    el('journalRuleForm')?.reset();
    if (el('journalRuleId')) el('journalRuleId').value = '';
    if (el('journalRuleSort')) el('journalRuleSort').value = '10';
    if (el('journalRuleActive')) el('journalRuleActive').checked = true;
    if (el('journalRuleFormTitle')) el('journalRuleFormTitle').textContent = 'Tambah Baris Debit/Kredit';
    el('journalRuleCancel')?.classList.add('hidden');
    if (el('journalRuleFixedAccount')) el('journalRuleFixedAccount').innerHTML = accountOptions('', '', true);
    toggleFixedAccount();
  }

  async function saveJournalRule(event) {
    event.preventDefault();
    const category = selectedCategory();
    if (!category) return;
    const id = state.editingRuleId;
    try {
      await api(id ? `/api/admin/settings/accounting/journal-rules/${encodeURIComponent(id)}` : '/api/admin/settings/accounting/journal-rules', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          transactionCategoryId: category.id,
          label: el('journalRuleLabel').value,
          side: el('journalRuleSide').value,
          sourceType: el('journalRuleSource').value,
          fixedAccountId: el('journalRuleSource').value === 'fixed_account' ? el('journalRuleFixedAccount').value : null,
          sortOrder: Number(el('journalRuleSort').value || 0),
          isActive: el('journalRuleActive').checked
        })
      });
      resetJournalRuleForm();
      await loadAccounting(true);
      toast('Journal rule tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function loadAccounting(force = false) {
    if (state.accounting && !force) return state.accounting;
    state.accounting = await api('/api/admin/settings/accounting');
    renderAccounting();
    return state.accounting;
  }

  function renderWarehouse() {
    if (!state.warehouse) return;
    const warehouses = state.warehouse.warehouses || [];
    if (!warehouses.some(item => item.id === state.selectedWarehouseId)) state.selectedWarehouseId = warehouses[0]?.id || '';
    el('warehouseCount').textContent = String(warehouses.length);
    el('warehouseList').innerHTML = warehouses.map(item => `<div class="settings-item ${item.id === state.selectedWarehouseId ? 'active-select' : ''}"><div class="settings-row"><div><b>${esc(item.code)} · ${esc(item.name)}</b><div class="settings-meta">${esc(item.locationName || 'Tanpa label lokasi')} · ${item.isActive ? 'aktif' : 'nonaktif'}</div></div><div><button class="mini-btn" type="button" data-select-warehouse="${esc(item.id)}">Kelola</button> <button class="mini-btn" type="button" data-edit-warehouse="${esc(item.id)}">Edit</button></div></div></div>`).join('') || '<div class="empty">Belum ada gudang. Tambahkan lokasi operasional pertama.</div>';
    document.querySelectorAll('[data-select-warehouse]').forEach(button => button.addEventListener('click', () => { state.selectedWarehouseId = button.dataset.selectWarehouse; renderWarehouse(); }));
    document.querySelectorAll('[data-edit-warehouse]').forEach(button => button.addEventListener('click', () => editWarehouse(button.dataset.editWarehouse)));
    renderWarehouseSelected();
    renderWarehouseRegisteredTransactions();
  }

  function selectedWarehouse() {
    return (state.warehouse?.warehouses || []).find(item => item.id === state.selectedWarehouseId) || null;
  }

  function renderWarehouseSelected() {
    const warehouse = selectedWarehouse();
    const accessForm = el('warehouseAccessForm');
    const opnameForm = el('warehouseOpnameForm');
    accessForm.classList.toggle('hidden', !warehouse);
    opnameForm.classList.toggle('hidden', !warehouse);
    if (!warehouse) return;
    el('warehouseAccessTitle').textContent = `${warehouse.code} · ${warehouse.name}`;
    el('warehousePrincipal').innerHTML = (state.warehouse.principals || []).map(person => `<option value="${esc(person.type)}|${esc(person.id)}">${esc(person.name)} · ${esc(person.type)}</option>`).join('');
    const accessRows = (state.warehouse.access || []).filter(item => item.warehouseId === warehouse.id);
    el('warehouseAccessList').innerHTML = accessRows.map(item => `<div class="settings-item"><b>${esc(item.principalName)}</b><div class="settings-meta">${esc(item.principalType)} · ${item.canStockOpname ? 'Opname ' : ''}${item.canTransfer ? 'Transfer ' : ''}${item.canReceive ? 'Masuk ' : ''}${item.canIssue ? 'Keluar' : ''}</div></div>`).join('') || '<div class="muted">Belum ada hak akses explicit.</div>';
    el('warehouseQtyTolerance').value = warehouse.opname.quantityTolerance || '0';
    el('warehousePercentTolerance').value = String(warehouse.opname.percentageTolerance || 0);
    el('warehouseScheduleType').value = warehouse.opname.scheduleType || 'MANUAL';
    el('warehouseScheduleDay').value = warehouse.opname.scheduleDay == null ? '' : String(warehouse.opname.scheduleDay);
    el('warehouseRequiresApproval').checked = warehouse.opname.requiresApproval !== false;
    toggleScheduleDay();
  }

  function renderWarehouseRegisteredTransactions() {
    el('warehouseRegisteredTransactions').innerHTML = (state.warehouse?.registeredTransactions || []).map(item => `<div class="settings-item"><b>${esc(item.code)} · ${esc(item.name)}</b><div class="settings-meta">${esc(item.description)}</div></div>`).join('') || '<div class="empty">Belum ada transaction category warehouse terdaftar.</div>';
  }

  function editWarehouse(id) {
    const item = state.warehouse.warehouses.find(row => row.id === id);
    if (!item) return;
    el('warehouseId').value = id;
    el('warehouseCode').value = item.code;
    el('warehouseCode').disabled = true;
    el('warehouseName').value = item.name;
    el('warehouseLocation').value = item.locationName || '';
    el('warehouseActive').checked = item.isActive;
    el('warehouseFormTitle').textContent = 'Edit Gudang / Lokasi';
    el('warehouseCancel').classList.remove('hidden');
  }

  function resetWarehouseForm() {
    el('warehouseForm').reset();
    el('warehouseId').value = '';
    el('warehouseCode').disabled = false;
    el('warehouseActive').checked = true;
    el('warehouseFormTitle').textContent = 'Tambah Gudang / Lokasi';
    el('warehouseCancel').classList.add('hidden');
  }

  async function saveWarehouse(event) {
    event.preventDefault();
    const id = el('warehouseId').value;
    try {
      const result = await api(id ? `/api/admin/settings/warehouse/warehouses/${encodeURIComponent(id)}` : '/api/admin/settings/warehouse/warehouses', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({ code: el('warehouseCode').value, name: el('warehouseName').value, locationName: el('warehouseLocation').value, isActive: el('warehouseActive').checked })
      });
      resetWarehouseForm();
      if (result.id) state.selectedWarehouseId = result.id;
      await loadWarehouse(true);
      toast('Gudang tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function saveWarehouseAccess(event) {
    event.preventDefault();
    const warehouse = selectedWarehouse();
    if (!warehouse) return;
    const [principalType, principalId] = el('warehousePrincipal').value.split('|');
    try {
      await api(`/api/admin/settings/warehouse/warehouses/${encodeURIComponent(warehouse.id)}/access`, {
        method: 'PUT',
        body: JSON.stringify({ principalType, principalId, canStockOpname: el('warehouseCanOpname').checked, canTransfer: el('warehouseCanTransfer').checked, canReceive: el('warehouseCanReceive').checked, canIssue: el('warehouseCanIssue').checked, isActive: true })
      });
      await loadWarehouse(true);
      toast('Hak akses gudang tersimpan');
    } catch (error) { toast(error.message); }
  }

  function toggleScheduleDay() {
    const type = el('warehouseScheduleType')?.value || 'MANUAL';
    el('warehouseScheduleDayWrap')?.classList.toggle('hidden', !['WEEKLY','MONTHLY'].includes(type));
  }

  async function saveWarehouseOpname(event) {
    event.preventDefault();
    const warehouse = selectedWarehouse();
    if (!warehouse) return;
    try {
      await api(`/api/admin/settings/warehouse/warehouses/${encodeURIComponent(warehouse.id)}/opname-settings`, {
        method: 'PUT',
        body: JSON.stringify({ quantityTolerance: el('warehouseQtyTolerance').value, percentageTolerance: el('warehousePercentTolerance').value, scheduleType: el('warehouseScheduleType').value, scheduleDay: el('warehouseScheduleDay').value, requiresApproval: el('warehouseRequiresApproval').checked })
      });
      await loadWarehouse(true);
      toast('Parameter stock opname tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function loadWarehouse(force = false) {
    if (state.warehouse && !force) return state.warehouse;
    state.warehouse = await api('/api/admin/settings/warehouse');
    renderWarehouse();
    return state.warehouse;
  }

  function mount() {
    injectStyle();
    mountPanels();
    const gate = el('authGate');
    if (gate) new MutationObserver(() => {
      if (gate.classList.contains('hidden')) {
        Promise.all([loadAccounting(true), loadWarehouse(true)]).catch(error => toast(error.message));
      }
    }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  }

  mount();
})();
