const ownerState = {
  token: sessionStorage.getItem('lekerOwnerToken') || '',
  owner: null,
  stores: [],
  sharingGroups: []
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
    await loadOwnerData();
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
  renderCustomerSharing();
}

function showOwnerLogin() {
  ownerEl('ownerLoginView').classList.remove('hidden');
  ownerEl('ownerApp').classList.add('hidden');
  ownerEl('ownerLogoutBtn').classList.add('hidden');
}

async function loadOwnerData() {
  const [storePayload, sharingPayload] = await Promise.all([
    ownerApi('/api/owner/stores'),
    ownerApi('/api/owner/customer-sharing')
  ]);
  ownerState.owner = storePayload.owner;
  ownerState.stores = storePayload.stores || [];
  ownerState.sharingGroups = sharingPayload.groups || [];
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

function renderSharingStoreOptions(selectedIds = []) {
  const selected = new Set(selectedIds);
  ownerEl('customerSharingStores').innerHTML = ownerState.stores.length ? ownerState.stores.map(store => `
    <label class="admin-check" style="justify-content:flex-start;gap:8px">
      <input type="checkbox" data-sharing-store="${ownerEscape(store.id)}" ${selected.has(store.id) ? 'checked' : ''} />
      <span><b>${ownerEscape(store.code)}</b> · ${ownerEscape(store.storeName)}${store.isActive ? '' : ' · nonaktif'}</span>
    </label>`).join('') : '<div class="empty">Belum ada gerai.</div>';
}

function renderCustomerSharing() {
  ownerEl('customerSharingCount').textContent = ownerState.sharingGroups.filter(group => group.isActive).length;
  ownerEl('customerSharingList').innerHTML = ownerState.sharingGroups.length ? ownerState.sharingGroups.map(group => `
    <div class="master-row contact-row ${group.isActive ? '' : 'inactive'}">
      <div class="master-main">
        <strong>${ownerEscape(group.name)}</strong>
        <div class="master-meta">${group.stores.length ? group.stores.map(store => ownerEscape(store.code)).join(' ↔ ') : 'Tidak ada gerai'}</div>
        <div class="master-meta">${group.isActive ? 'Berbagi pelanggan aktif' : 'Nonaktif'}</div>
      </div>
      <div class="master-actions">
        ${group.isActive ? `<button class="mini-btn" type="button" data-edit-sharing="${ownerEscape(group.id)}">Edit</button><button class="mini-btn danger" type="button" data-disable-sharing="${ownerEscape(group.id)}">Matikan</button>` : ''}
      </div>
    </div>`).join('') : '<div class="empty">Belum ada grup berbagi pelanggan.</div>';
  document.querySelectorAll('[data-edit-sharing]').forEach(button => button.onclick = () => editCustomerSharing(button.dataset.editSharing));
  document.querySelectorAll('[data-disable-sharing]').forEach(button => button.onclick = () => disableCustomerSharing(button.dataset.disableSharing));
  if (!ownerEl('customerSharingId').value) renderSharingStoreOptions();
}

function resetCustomerSharingForm() {
  ownerEl('customerSharingForm').reset();
  ownerEl('customerSharingId').value = '';
  ownerEl('customerSharingTitle').textContent = 'Buat grup berbagi pelanggan';
  ownerEl('customerSharingCancel').classList.add('hidden');
  renderSharingStoreOptions();
}

function editCustomerSharing(id) {
  const group = ownerState.sharingGroups.find(item => item.id === id);
  if (!group) return;
  ownerEl('customerSharingId').value = group.id;
  ownerEl('customerSharingName').value = group.name;
  ownerEl('customerSharingTitle').textContent = `Edit ${group.name}`;
  ownerEl('customerSharingCancel').classList.remove('hidden');
  renderSharingStoreOptions(group.stores.map(store => store.id));
  ownerEl('customerSharingForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveCustomerSharing(event) {
  event.preventDefault();
  const id = ownerEl('customerSharingId').value;
  const storeIds = [...document.querySelectorAll('[data-sharing-store]:checked')].map(input => input.dataset.sharingStore);
  try {
    await ownerApi(id ? `/api/owner/customer-sharing/groups/${encodeURIComponent(id)}` : '/api/owner/customer-sharing/groups', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify({ name: ownerEl('customerSharingName').value, storeIds })
    });
    await loadOwnerData();
    resetCustomerSharingForm();
    renderOwnerStores();
    renderCustomerSharing();
    ownerToast(id ? 'Sharing pelanggan diperbarui' : 'Sharing pelanggan dibuat');
  } catch (error) { ownerToast(error.message); }
}

async function disableCustomerSharing(id) {
  if (!confirm('Matikan sharing pelanggan grup ini? Master dan transaksi gerai tetap tidak berubah.')) return;
  try {
    await ownerApi(`/api/owner/customer-sharing/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadOwnerData();
    resetCustomerSharingForm();
    renderCustomerSharing();
    ownerToast('Sharing pelanggan dimatikan');
  } catch (error) { ownerToast(error.message); }
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
    await loadOwnerData();
    renderOwnerStores();
    renderCustomerSharing();
    ownerToast(`Gerai ${payload.store.code} dibuat`);
  } catch (error) { ownerToast(error.message); }
}

async function ownerLogout() {
  try { await ownerApi('/api/owner/logout', { method: 'POST' }); } catch {}
  ownerState.token = '';
  ownerState.owner = null;
  ownerState.stores = [];
  ownerState.sharingGroups = [];
  sessionStorage.removeItem('lekerOwnerToken');
  showOwnerLogin();
}

async function initOwner() {
  ownerEl('ownerLoginBtn').addEventListener('click', ownerLogin);
  ownerEl('ownerPassword').addEventListener('keydown', event => { if (event.key === 'Enter') ownerLogin(); });
  ownerEl('storeCreateForm').addEventListener('submit', createOwnerStore);
  ownerEl('customerSharingForm').addEventListener('submit', saveCustomerSharing);
  ownerEl('customerSharingCancel').addEventListener('click', resetCustomerSharingForm);
  ownerEl('ownerLogoutBtn').addEventListener('click', ownerLogout);

  if (!ownerState.token) return showOwnerLogin();
  try {
    const me = await ownerApi('/api/owner/me');
    ownerState.owner = me.owner;
    await loadOwnerData();
    showOwnerApp();
  } catch {
    sessionStorage.removeItem('lekerOwnerToken');
    ownerState.token = '';
    showOwnerLogin();
  }
}

initOwner();
