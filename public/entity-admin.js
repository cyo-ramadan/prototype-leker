const entityAdminState = {
  token: sessionStorage.getItem('lekerEntityAdminToken') || '',
  entityAdmin: null,
  stores: [],
  accounts: [],
  journals: []
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
    sessionStorage.setItem('lekerEntityAdminToken', payload.token);
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
  sessionStorage.removeItem('lekerEntityAdminToken');
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

  if (!entityAdminState.token) return showEntityAdminLogin();
  try {
    await loadEntityAdminData();
    showEntityAdminApp();
  } catch {
    sessionStorage.removeItem('lekerEntityAdminToken');
    entityAdminState.token = '';
    showEntityAdminLogin();
  }
}

initEntityAdmin();
