const entityAdminState = {
  token: localStorage.getItem('lekerEntityAdminToken') || '',
  entityAdmin: null,
  stores: [],
  accounts: [],
  journals: [],
  productMasters: [],
  employees: []
};

const entityAdminEl = id => document.getElementById(id);
const entityAdminEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

async function entityAdminApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (entityAdminState.token) headers.Authorization = `Bearer ${entityAdminState.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status });
  return payload;
}

function entityAdminToast(message) {
  const node = entityAdminEl('entityAdminToast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(entityAdminToast.timer);
  entityAdminToast.timer = setTimeout(() => node.classList.remove('show'), 1900);
}

async function entityAdminLogin() {
  entityAdminEl('entityAdminLoginMessage').textContent = '';
  try {
    const payload = await entityAdminApi('/api/entity-admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: entityAdminEl('entityAdminUsername').value,
        password: entityAdminEl('entityAdminPassword').value
      })
    });
    entityAdminState.token = payload.token;
    entityAdminState.entityAdmin = payload.entityAdmin;
    localStorage.setItem('lekerEntityAdminToken', payload.token);
    entityAdminEl('entityAdminPassword').value = '';
    await loadEntityAdminData();
    showEntityAdminApp();
  } catch (error) {
    entityAdminEl('entityAdminLoginMessage').textContent = error.message;
  }
}

function showEntityAdminApp() {
  entityAdminEl('entityAdminLoginView').classList.add('hidden');
  entityAdminEl('entityAdminApp').classList.remove('hidden');
  entityAdminEl('entityAdminLogoutBtn').classList.remove('hidden');
  entityAdminEl('entityAdminIdentity').textContent = entityAdminState.entityAdmin?.displayName || entityAdminState.entityAdmin?.username || 'Entity Admin';
  entityAdminEl('entityAdminEntityName').textContent = entityAdminState.entityAdmin?.entityName || 'Entity';
  renderEntityAdminStores();
  loadEntityLedger().catch(error => entityAdminToast(error.message));
}

// --- Buku Entity ---------------------------------------------------------

function switchEntityTab(name) {
  document.querySelectorAll('[data-entity-tab]').forEach(button => button.classList.toggle('active', button.dataset.entityTab === name));
  entityAdminEl('entityTab-stores')?.classList.toggle('active', name === 'stores');
  entityAdminEl('entityTab-ledger')?.classList.toggle('active', name === 'ledger');
  entityAdminEl('entityTab-productmasters')?.classList.toggle('active', name === 'productmasters');
  entityAdminEl('entityTab-employees')?.classList.toggle('active', name === 'employees');
  entityAdminEl('entityTab-reports')?.classList.toggle('active', name === 'reports');
  if (name === 'productmasters') loadEntityProductMasters().catch(error => entityAdminToast(error.message));
  if (name === 'employees') loadEntityEmployees().catch(error => entityAdminToast(error.message));
  if (name === 'reports') renderEntityReportStoreChecklist();
}

// Master Barang & Karyawan (ADR-043) sudah entity-scoped di backend
// (src/product-master.js, src/employee-master.js), tapi endpoint-nya masih
// butuh ?store= untuk resolve entity_id (pola requireManagement yang sama
// dipakai Admin Gerai). Panel Entity Admin tidak punya konsep "gerai yang
// sedang dibuka" seperti Admin Gerai, jadi dipakai gerai PERTAMA milik
// entity ini murni sebagai kendaraan resolusi -- hasilnya tetap data
// seluruh entity, bukan data gerai itu saja (listEmployees/loadCatalog
// keduanya sudah filter by entity_id, bukan store_id).
function anyEntityStoreCode() {
  return entityAdminState.stores[0]?.code || '';
}

// --- Master Barang Entity -------------------------------------------------

async function loadEntityProductMasters() {
  const storeCode = anyEntityStoreCode();
  if (!storeCode) {
    entityAdminEl('entityProductMasterList').innerHTML = '<div class="empty">Belum ada gerai di entity ini.</div>';
    return;
  }
  const payload = await entityAdminApi(`/api/admin/product-masters?store=${encodeURIComponent(storeCode)}`);
  entityAdminState.productMasters = payload.catalog || [];
  renderEntityProductMasters();
}

function renderEntityProductMasterRecipeList(entry) {
  if (!entry.recipeReference.length) return '<span class="muted">Belum ada resep acuan.</span>';
  return entry.recipeReference.map(component =>
    `${entityAdminEscape(component.ingredientLabel)}${component.quantityLabel ? ` · ${entityAdminEscape(component.quantityLabel)}` : ''}`
  ).join(', ');
}

function renderEntityProductMasters() {
  const list = entityAdminEl('entityProductMasterList');
  const catalog = entityAdminState.productMasters || [];
  list.innerHTML = catalog.length ? catalog.map(entry => `
    <div class="master-row contact-row" data-entity-pm-row="${entityAdminEscape(entry.id)}">
      ${entry.imageData ? `<img class="master-thumb" src="${entityAdminEscape(entry.imageData)}" alt="${entityAdminEscape(entry.name || entry.code)}" />` : ''}
      <div class="master-main">
        <strong>${entityAdminEscape(entry.code)}${entry.name ? ` · ${entityAdminEscape(entry.name)}` : ''}</strong>
        <div class="master-meta">Dipakai ${entry.usedByStores.length} gerai${entry.usedByStores.length ? `: ${entry.usedByStores.map(u => entityAdminEscape(u.storeCode)).join(', ')}` : ''}</div>
        <div class="master-meta">Resep acuan: ${renderEntityProductMasterRecipeList(entry)}</div>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada Kode Barang di entity ini. Daftarkan lewat field "Kode Barang" saat menambah/edit barang di Admin Gerai.</div>';
}

// --- Karyawan level Entity -------------------------------------------------

async function loadEntityEmployees() {
  const storeCode = anyEntityStoreCode();
  if (!storeCode) {
    entityAdminEl('entityEmployeeList').innerHTML = '<div class="empty">Belum ada gerai di entity ini.</div>';
    return;
  }
  const payload = await entityAdminApi(`/api/admin/employees?store=${encodeURIComponent(storeCode)}`);
  entityAdminState.employees = payload.employees || [];
  renderEntityEmployees();
}

function renderEntityEmployees() {
  const employees = entityAdminState.employees || [];
  entityAdminEl('entityEmployeeCount').textContent = employees.length;
  entityAdminEl('entityEmployeeList').innerHTML = employees.length ? employees.map(employee => `
    <div class="master-row contact-row ${employee.status === 'ACTIVE' ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${entityAdminEscape(employee.fullName)}</strong>
        <div class="master-meta">${employee.entityLevel ? 'Level Entity (tanpa gerai perekrut)' : `Direkrut ${entityAdminEscape(employee.homeStoreCode)} · ${entityAdminEscape(employee.homeStoreName)}`} · ${employee.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</div>
        <div class="master-meta">${employee.links.length ? `Akun: ${employee.links.map(link => `${entityAdminEscape(link.username)}${link.storeCode ? ` @${entityAdminEscape(link.storeCode)}` : ' (Entity Admin)'}`).join(', ')}` : 'Belum ada akun ditautkan'}</div>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada karyawan di entity ini.</div>';
}

// --- Laporan Net Profit Harian ---------------------------------------------

function todayJakartaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderEntityReportStoreChecklist() {
  const box = entityAdminEl('entityReportStoreChecklist');
  // Mount sekali saja begitu daftar gerai sudah ada -- checklist tidak
  // boleh reset centangan pengguna tiap gonta-ganti tab bolak-balik.
  if (!box || box.dataset.mounted === '1' || !entityAdminState.stores.length) return;
  box.dataset.mounted = '1';
  box.innerHTML = entityAdminState.stores.map(store => `
    <label class="admin-check" style="font-weight:600">
      <input type="checkbox" value="${entityAdminEscape(store.code)}" checked /> ${entityAdminEscape(store.code)}
    </label>`).join('');
  if (!entityAdminEl('entityReportFrom').value) {
    const today = todayJakartaDate();
    entityAdminEl('entityReportFrom').value = today;
    entityAdminEl('entityReportTo').value = today;
  }
}

function selectedReportStoreCodes() {
  return [...document.querySelectorAll('#entityReportStoreChecklist input[type="checkbox"]:checked')].map(input => input.value);
}

const entityReportRupiah = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0);

function renderEntityReportTable(payload) {
  const wrap = entityAdminEl('entityReportTableWrap');
  if (!payload.rows.length || !payload.stores.length) {
    wrap.innerHTML = '<div class="empty">Tidak ada data untuk periode/gerai ini.</div>';
    return;
  }
  const cell = value => `<td style="padding:6px 10px;text-align:right;white-space:nowrap${value < 0 ? ';color:#b91c1c;font-weight:700' : ''}">${entityReportRupiah(value)}</td>`;
  const header = `<tr>
    <th style="padding:6px 10px;text-align:left">Tanggal</th>
    ${payload.stores.map(store => `<th style="padding:6px 10px;text-align:right">${entityAdminEscape(store.code)}</th>`).join('')}
    <th style="padding:6px 10px;text-align:right">Total</th>
  </tr>`;
  const body = payload.rows.map(row => `<tr>
    <td style="padding:6px 10px;white-space:nowrap">${entityAdminEscape(row.businessDate)}</td>
    ${payload.stores.map(store => cell(row.byStore[store.code] || 0)).join('')}
    ${cell(row.total)}
  </tr>`).join('');
  const footer = `<tr style="font-weight:800;border-top:2px solid var(--line)">
    <td style="padding:6px 10px">Total</td>
    ${payload.stores.map(store => cell(payload.totals.byStore[store.code] || 0)).join('')}
    ${cell(payload.totals.total)}
  </tr>`;
  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:14px">${header}${body}${footer}</table>`;
}

async function runEntityReport() {
  const from = entityAdminEl('entityReportFrom').value;
  const to = entityAdminEl('entityReportTo').value;
  const codes = selectedReportStoreCodes();
  const status = entityAdminEl('entityReportStatus');
  if (!from || !to) { status.textContent = 'Isi dari/sampai tanggal dulu.'; return; }
  if (!codes.length) { status.textContent = 'Pilih minimal satu gerai.'; return; }
  status.textContent = 'Menghitung… (pertama kali untuk periode baru bisa agak lama, sesudahnya instan)';
  // ?store= WAJIB ada -- server memakainya untuk tahu entity mana yang
  // memanggil (selectedStore() di src/net-profit-report.js). Tanpa ini,
  // request jatuh ke gerai default (G001) yang bisa saja bukan bagian dari
  // entity Bos Cyo sama sekali, jadi seluruh gerai yang diminta ditolak
  // sebagai "di luar entity" -- laporan kelihatan kosong tanpa pesan yang
  // jelas kenapa (dibuktikan langsung, 2026-09-17).
  const callerStoreCode = anyEntityStoreCode();
  if (!callerStoreCode) { status.textContent = 'Belum ada gerai di entity ini.'; return; }
  try {
    const payload = await entityAdminApi(`/api/admin/reports/net-profit?store=${encodeURIComponent(callerStoreCode)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&stores=${encodeURIComponent(codes.join(','))}`);
    renderEntityReportTable(payload);
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  }
}

async function saveEntityEmployee(event) {
  event.preventDefault();
  const storeCode = anyEntityStoreCode();
  if (!storeCode) { entityAdminToast('Belum ada gerai di entity ini.'); return; }
  try {
    await entityAdminApi(`/api/admin/employees?store=${encodeURIComponent(storeCode)}`, {
      method: 'POST',
      body: JSON.stringify({
        scope: 'ENTITY',
        fullName: entityAdminEl('entityEmployeeName').value,
        phone: entityAdminEl('entityEmployeePhone').value,
        address: entityAdminEl('entityEmployeeAddress').value,
        note: entityAdminEl('entityEmployeeNote').value
      })
    });
    entityAdminEl('entityEmployeeForm').reset();
    await loadEntityEmployees();
    entityAdminToast('Karyawan level Entity ditambahkan');
  } catch (error) { entityAdminToast(error.message); }
}

async function loadEntityLedger() {
  const [accountsPayload, journalsPayload] = await Promise.all([
    entityAdminApi('/api/entity-admin/accounts'),
    entityAdminApi('/api/entity-admin/journals')
  ]);
  entityAdminState.accounts = accountsPayload.accounts || [];
  entityAdminState.journals = journalsPayload.journals || [];
  renderEntityAccounts();
  renderEntityJournalAccountOptions();
  renderEntityJournals();
}

const ENTITY_ACCOUNT_TYPE_LABEL = { ASSET: 'Aset', LIABILITY: 'Kewajiban', EQUITY: 'Ekuitas', REVENUE: 'Pendapatan', EXPENSE: 'Beban' };

function renderEntityAccounts() {
  entityAdminEl('entityAccountCount').textContent = entityAdminState.accounts.length;
  entityAdminEl('entityAccountList').innerHTML = entityAdminState.accounts.length ? entityAdminState.accounts.map(account => `
    <div class="master-row contact-row ${account.isActive ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</strong>
        <div class="master-meta">${entityAdminEscape(ENTITY_ACCOUNT_TYPE_LABEL[account.accountType] || account.accountType)}${account.subtype ? ` · ${entityAdminEscape(account.subtype)}` : ''} · ${account.isActive ? 'Aktif' : 'Nonaktif'}</div>
      </div>
      <div class="master-actions">
        <button class="mini-btn" type="button" data-edit-entity-account="${entityAdminEscape(account.accountId)}">Edit</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada akun di buku Entity ini.</div>';

  document.querySelectorAll('[data-edit-entity-account]').forEach(button => button.onclick = () => editEntityAccount(button.dataset.editEntityAccount));
}

function resetEntityAccountForm() {
  entityAdminEl('entityAccountForm').reset();
  entityAdminEl('entityAccountId').value = '';
  entityAdminEl('entityAccountActive').checked = true;
  entityAdminEl('entityAccountFormTitle').textContent = 'Tambah akun Entity';
  entityAdminEl('entityAccountCancelEdit').classList.add('hidden');
}

function editEntityAccount(id) {
  const account = entityAdminState.accounts.find(item => item.accountId === id);
  if (!account) return;
  entityAdminEl('entityAccountId').value = account.accountId;
  entityAdminEl('entityAccountName').value = account.accountName;
  entityAdminEl('entityAccountType').value = account.accountType;
  entityAdminEl('entityAccountSubtype').value = account.subtype;
  entityAdminEl('entityAccountActive').checked = account.isActive;
  entityAdminEl('entityAccountFormTitle').textContent = 'Edit akun Entity';
  entityAdminEl('entityAccountCancelEdit').classList.remove('hidden');
  entityAdminEl('entityAccountForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveEntityAccount(event) {
  event.preventDefault();
  const id = entityAdminEl('entityAccountId').value;
  const payload = {
    accountName: entityAdminEl('entityAccountName').value,
    accountType: entityAdminEl('entityAccountType').value,
    subtype: entityAdminEl('entityAccountSubtype').value,
    isActive: entityAdminEl('entityAccountActive').checked
  };
  try {
    await entityAdminApi(id ? `/api/entity-admin/accounts/${encodeURIComponent(id)}` : '/api/entity-admin/accounts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    await loadEntityLedger();
    resetEntityAccountForm();
    entityAdminToast(id ? 'Akun Entity diperbarui' : 'Akun Entity ditambahkan');
  } catch (error) { entityAdminToast(error.message); }
}

function entityJournalLineRow(index) {
  const options = entityAdminState.accounts.filter(account => account.isActive)
    .map(account => `<option value="${entityAdminEscape(account.accountId)}">${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</option>`).join('');
  return `
    <div class="admin-grid two compact" data-entity-journal-line="${index}" style="margin-bottom:8px">
      <select data-line-account class="text-input"><option value="">Pilih akun…</option>${options}</select>
      <div style="display:flex;gap:8px">
        <select data-line-side class="text-input" style="max-width:110px"><option value="DEBIT">Debit</option><option value="CREDIT">Kredit</option></select>
        <input data-line-amount class="text-input" type="text" inputmode="decimal" placeholder="nominal" />
        <button class="mini-btn danger" type="button" data-remove-line>×</button>
      </div>
    </div>`;
}

function renderEntityJournalAccountOptions() {
  document.querySelectorAll('[data-line-account]').forEach(select => {
    const current = select.value;
    const options = entityAdminState.accounts.filter(account => account.isActive)
      .map(account => `<option value="${entityAdminEscape(account.accountId)}">${entityAdminEscape(account.accountCode)} · ${entityAdminEscape(account.accountName)}</option>`).join('');
    select.innerHTML = `<option value="">Pilih akun…</option>${options}`;
    select.value = current;
  });
}

function addEntityJournalLine() {
  const container = entityAdminEl('entityJournalLines');
  const index = container.children.length;
  container.insertAdjacentHTML('beforeend', entityJournalLineRow(index));
  container.lastElementChild.querySelector('[data-remove-line]').onclick = event => {
    event.target.closest('[data-entity-journal-line]').remove();
    updateEntityJournalBalanceHint();
  };
  container.querySelectorAll('[data-line-amount], [data-line-side]').forEach(input => {
    input.oninput = updateEntityJournalBalanceHint;
  });
  updateEntityJournalBalanceHint();
}

function updateEntityJournalBalanceHint() {
  let debit = 0;
  let credit = 0;
  document.querySelectorAll('[data-entity-journal-line]').forEach(row => {
    const amount = Number(String(row.querySelector('[data-line-amount]').value || '0').replace(',', '.')) || 0;
    if (row.querySelector('[data-line-side]').value === 'DEBIT') debit += amount; else credit += amount;
  });
  const hint = entityAdminEl('entityJournalBalanceHint');
  const balanced = debit === credit && debit > 0;
  hint.textContent = `Debit ${debit.toLocaleString('id-ID')} · Kredit ${credit.toLocaleString('id-ID')}${balanced ? ' · Balance ✓' : ' · belum balance'}`;
  hint.style.color = balanced ? '' : '#b45309';
}

async function submitEntityJournal(event) {
  event.preventDefault();
  const lines = [...document.querySelectorAll('[data-entity-journal-line]')].map(row => ({
    accountId: row.querySelector('[data-line-account]').value,
    side: row.querySelector('[data-line-side]').value,
    amountExact: row.querySelector('[data-line-amount]').value
  })).filter(line => line.accountId && line.amountExact);
  try {
    await entityAdminApi('/api/entity-admin/journals', {
      method: 'POST',
      body: JSON.stringify({
        businessDate: entityAdminEl('entityJournalDate').value,
        description: entityAdminEl('entityJournalDescription').value,
        journalLines: lines
      })
    });
    await loadEntityLedger();
    entityAdminEl('entityJournalForm').reset();
    entityAdminEl('entityJournalLines').innerHTML = '';
    addEntityJournalLine();
    addEntityJournalLine();
    entityAdminToast('Jurnal Entity terposting');
  } catch (error) { entityAdminToast(error.message); }
}

function renderEntityJournals() {
  entityAdminEl('entityJournalCount').textContent = entityAdminState.journals.length;
  entityAdminEl('entityJournalList').innerHTML = entityAdminState.journals.length ? entityAdminState.journals.map(journal => `
    <div class="master-row contact-row">
      <div class="master-main">
        <strong>${entityAdminEscape(journal.journalNumber)}</strong>
        <div class="master-meta">${entityAdminEscape(journal.businessDate)} · ${entityAdminEscape(journal.description)}${journal.isReversal ? ' · reversal' : ''}</div>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada jurnal di buku Entity ini.</div>';
}

function showEntityAdminLogin() {
  entityAdminEl('entityAdminLoginView').classList.remove('hidden');
  entityAdminEl('entityAdminApp').classList.add('hidden');
  entityAdminEl('entityAdminLogoutBtn').classList.add('hidden');
}

async function loadEntityAdminData() {
  const payload = await entityAdminApi('/api/entity-admin/stores');
  entityAdminState.entityAdmin = payload.entityAdmin;
  entityAdminState.stores = payload.stores || [];
}

function renderEntityAdminStores() {
  entityAdminEl('entityAdminStoreCount').textContent = entityAdminState.stores.length;
  entityAdminEl('entityAdminStoreList').innerHTML = entityAdminState.stores.length ? entityAdminState.stores.map(store => `
    <article class="owner-store-card ${store.isActive ? '' : 'inactive'}">
      <div class="owner-store-code">${entityAdminEscape(store.code)}</div>
      <h3>${entityAdminEscape(store.storeName)}</h3>
      <p>${entityAdminEscape(store.address || 'Alamat belum diisi')}</p>
      <div class="owner-store-status">${store.isActive ? '● Aktif' : '○ Nonaktif'}</div>
      <div class="owner-store-actions">
        <a class="primary-btn owner-link-btn" href="/s/${encodeURIComponent(store.code)}/admin">Buka Workspace</a>
      </div>
    </article>`).join('') : '<div class="empty">Belum ada gerai yang tertaut ke entity ini.</div>';
}

async function entityAdminLogout() {
  try { await entityAdminApi('/api/entity-admin/logout', { method: 'POST' }); } catch {}
  entityAdminState.token = '';
  entityAdminState.entityAdmin = null;
  entityAdminState.stores = [];
  window.lekerClearStaffSession?.();
  localStorage.removeItem('lekerEntityAdminToken');
  showEntityAdminLogin();
}

async function initEntityAdmin() {
  entityAdminEl('entityAdminLoginBtn').addEventListener('click', entityAdminLogin);
  entityAdminEl('entityAdminPassword').addEventListener('keydown', event => { if (event.key === 'Enter') entityAdminLogin(); });
  entityAdminEl('entityAdminLogoutBtn').addEventListener('click', entityAdminLogout);
  document.querySelectorAll('[data-entity-tab]').forEach(button => button.addEventListener('click', () => switchEntityTab(button.dataset.entityTab)));
  entityAdminEl('entityAccountForm').addEventListener('submit', saveEntityAccount);
  entityAdminEl('entityAccountCancelEdit').addEventListener('click', resetEntityAccountForm);
  entityAdminEl('entityJournalAddLine').addEventListener('click', addEntityJournalLine);
  entityAdminEl('entityJournalForm').addEventListener('submit', submitEntityJournal);
  addEntityJournalLine();
  addEntityJournalLine();
  entityAdminEl('entityProductMasterRefresh')?.addEventListener('click', () => loadEntityProductMasters().catch(error => entityAdminToast(error.message)));
  entityAdminEl('entityEmployeeForm')?.addEventListener('submit', saveEntityEmployee);
  entityAdminEl('entityReportRun')?.addEventListener('click', () => runEntityReport());

  if (!entityAdminState.token) return showEntityAdminLogin();
  try {
    await loadEntityAdminData();
    showEntityAdminApp();
  } catch {
    localStorage.removeItem('lekerEntityAdminToken');
    entityAdminState.token = '';
    showEntityAdminLogin();
  }
}

initEntityAdmin();
