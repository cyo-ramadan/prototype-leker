const entityAdminState = {
  token: sessionStorage.getItem('lekerEntityAdminToken') || '',
  entityAdmin: null,
  stores: []
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
