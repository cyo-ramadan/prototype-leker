const ownerState = {
  token: sessionStorage.getItem('lekerOwnerToken') || '',
  owner: null,
  stores: []
};

const ownerEl = id => document.getElementById(id);
const ownerEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

async function ownerApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (ownerState.token) headers.Authorization = `Bearer ${ownerState.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status });
  return payload;
}

function ownerToast(message) {
  const node = ownerEl('ownerToast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(ownerToast.timer);
  ownerToast.timer = setTimeout(() => node.classList.remove('show'), 1900);
}

async function ownerLogin() {
  ownerEl('ownerLoginMessage').textContent = '';
  try {
    const payload = await ownerApi('/api/owner/login', {
      method: 'POST',
      body: JSON.stringify({
        username: ownerEl('ownerUsername').value,
        password: ownerEl('ownerPassword').value
      })
    });
    ownerState.token = payload.token;
    ownerState.owner = payload.owner;
    sessionStorage.setItem('lekerOwnerToken', payload.token);
    ownerEl('ownerPassword').value = '';
    await loadOwnerStores();
    showOwnerApp();
  } catch (error) {
    ownerEl('ownerLoginMessage').textContent = error.message;
  }
}

function showOwnerApp() {
  ownerEl('ownerLoginView').classList.add('hidden');
  ownerEl('ownerApp').classList.remove('hidden');
  ownerEl('ownerLogoutBtn').classList.remove('hidden');
  ownerEl('ownerIdentity').textContent = ownerState.owner?.displayName || ownerState.owner?.username || 'Owner';
  renderOwnerStores();
}

function showOwnerLogin() {
  ownerEl('ownerLoginView').classList.remove('hidden');
  ownerEl('ownerApp').classList.add('hidden');
  ownerEl('ownerLogoutBtn').classList.add('hidden');
}

async function loadOwnerStores() {
  const payload = await ownerApi('/api/owner/stores');
  ownerState.owner = payload.owner;
  ownerState.stores = payload.stores || [];
}

function renderOwnerStores() {
  ownerEl('ownerStoreCount').textContent = ownerState.stores.length;
  ownerEl('ownerStoreList').innerHTML = ownerState.stores.length ? ownerState.stores.map(store => `
    <article class="owner-store-card ${store.isActive ? '' : 'inactive'}">
      <div class="owner-store-code">${ownerEscape(store.code)}</div>
      <h3>${ownerEscape(store.storeName)}</h3>
      <p>${ownerEscape(store.address || 'Alamat belum diisi')}</p>
      <div class="owner-store-status">${store.isActive ? '● Aktif' : '○ Nonaktif'}</div>
      <div class="owner-store-actions">
        <a class="primary-btn owner-link-btn" href="/s/${encodeURIComponent(store.code)}/admin">Buka Workspace</a>
        <a class="secondary-btn owner-link-btn" href="/s/${encodeURIComponent(store.code)}/customer">Customer</a>
      </div>
    </article>`).join('') : '<div class="empty">Belum ada gerai.</div>';
}

async function createOwnerStore(event) {
  event.preventDefault();
  try {
    const payload = await ownerApi('/api/owner/stores', {
      method: 'POST',
      body: JSON.stringify({
        code: ownerEl('ownerStoreCode').value,
        storeName: ownerEl('ownerStoreName').value,
        address: ownerEl('ownerStoreAddress').value
      })
    });
    ownerEl('storeCreateForm').reset();
    await loadOwnerStores();
    renderOwnerStores();
    ownerToast(`Gerai ${payload.store.code} dibuat`);
  } catch (error) { ownerToast(error.message); }
}

async function ownerLogout() {
  try { await ownerApi('/api/owner/logout', { method: 'POST' }); } catch {}
  ownerState.token = '';
  ownerState.owner = null;
  ownerState.stores = [];
  sessionStorage.removeItem('lekerOwnerToken');
  showOwnerLogin();
}

async function initOwner() {
  ownerEl('ownerLoginBtn').addEventListener('click', ownerLogin);
  ownerEl('ownerPassword').addEventListener('keydown', event => { if (event.key === 'Enter') ownerLogin(); });
  ownerEl('storeCreateForm').addEventListener('submit', createOwnerStore);
  ownerEl('ownerLogoutBtn').addEventListener('click', ownerLogout);

  if (!ownerState.token) return showOwnerLogin();
  try {
    const me = await ownerApi('/api/owner/me');
    ownerState.owner = me.owner;
    await loadOwnerStores();
    showOwnerApp();
  } catch {
    sessionStorage.removeItem('lekerOwnerToken');
    ownerState.token = '';
    showOwnerLogin();
  }
}

initOwner();
