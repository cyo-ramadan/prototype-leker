const state = {
  pin: sessionStorage.getItem('lekerAdminPin') || '',
  setupRequired: false,
  data: { store: null, products: [], categories: [], contacts: [] },
  productImageData: '',
  storeLogoData: ''
};

const el = id => document.getElementById(id);
const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.pin && !path.endsWith('/status') && !path.endsWith('/setup')) headers['X-Admin-Pin'] = state.pin;
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status, payload });
  return payload;
}

function toast(message) {
  const node = el('adminToast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 1800);
}

async function imageFileToDataUrl(file, maxSide, quality = .78) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca gambar.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibuka.'));
    img.src = source;
  });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function init() {
  bindStaticEvents();
  const status = await api('/api/admin/status');
  state.setupRequired = Boolean(status.setupRequired);
  el('authTitle').textContent = state.setupRequired ? 'Buat PIN Admin' : 'Buka Admin';
  el('authHelp').textContent = state.setupRequired
    ? 'Setup pertama. Buat PIN 4–12 digit di perangkat ini. PIN tidak dikirim ke chat.'
    : 'Masukkan PIN admin untuk membuka master data.';
  el('authBtn').textContent = state.setupRequired ? 'Aktifkan Admin' : 'Masuk';
  if (state.pin && !state.setupRequired) await unlock().catch(() => {
    state.pin = '';
    sessionStorage.removeItem('lekerAdminPin');
  });
}

function bindStaticEvents() {
  el('authBtn').addEventListener('click', authenticate);
  el('adminPin').addEventListener('keydown', event => { if (event.key === 'Enter') authenticate(); });
  el('logoutBtn').addEventListener('click', lockAdmin);
  document.querySelectorAll('.admin-tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  el('storeForm').addEventListener('submit', saveStore);
  el('storeLogo').addEventListener('change', previewStoreLogo);
  el('productForm').addEventListener('submit', saveProduct);
  el('productImage').addEventListener('change', previewProductImage);
  el('productCancelEdit').addEventListener('click', resetProductForm);
  el('categoryForm').addEventListener('submit', saveCategory);
  el('categoryCancelEdit').addEventListener('click', resetCategoryForm);
  el('contactForm').addEventListener('submit', saveContact);
  el('contactCancelEdit').addEventListener('click', resetContactForm);
}

async function authenticate() {
  const pin = el('adminPin').value.trim();
  if (!/^\d{4,12}$/.test(pin)) {
    el('authMessage').textContent = 'PIN harus 4–12 digit.';
    return;
  }
  el('authMessage').textContent = '';
  try {
    if (state.setupRequired) {
      await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ pin }) });
      state.setupRequired = false;
    }
    state.pin = pin;
    sessionStorage.setItem('lekerAdminPin', pin);
    await unlock();
  } catch (error) {
    state.pin = '';
    sessionStorage.removeItem('lekerAdminPin');
    el('authMessage').textContent = error.message;
  }
}

async function unlock() {
  state.data = await api('/api/admin/bootstrap');
  state.storeLogoData = state.data.store.logoData || '';
  el('authGate').classList.add('hidden');
  el('adminApp').classList.remove('hidden');
  el('logoutBtn').classList.remove('hidden');
  renderAll();
}

function lockAdmin() {
  state.pin = '';
  sessionStorage.removeItem('lekerAdminPin');
  el('adminPin').value = '';
  el('adminApp').classList.add('hidden');
  el('logoutBtn').classList.add('hidden');
  el('authGate').classList.remove('hidden');
}

function switchTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === `tab-${tab}`));
}

function renderAll() {
  renderStore();
  renderCategoryOptions();
  renderProducts();
  renderCategories();
  renderContacts();
  el('adminSummary').innerHTML = `
    <span>${state.data.products.filter(item => item.isActive).length} barang aktif</span>
    <span>${state.data.categories.filter(item => item.isActive).length} kategori</span>
    <span>${state.data.contacts.length} customer</span>`;
}

function renderStore() {
  el('storeName').value = state.data.store?.storeName || 'MAXI LEKER';
  state.storeLogoData = state.data.store?.logoData || '';
  el('storeLogoPreview').src = state.storeLogoData || '/default-product.svg';
}

async function previewStoreLogo() {
  try {
    const file = el('storeLogo').files[0];
    if (!file) return;
    state.storeLogoData = await imageFileToDataUrl(file, 420, .78);
    el('storeLogoPreview').src = state.storeLogoData;
  } catch (error) { toast(error.message); }
}

async function saveStore(event) {
  event.preventDefault();
  try {
    const payload = await api('/api/admin/store', {
      method: 'PUT',
      body: JSON.stringify({ storeName: el('storeName').value, logoData: state.storeLogoData })
    });
    state.data.store = payload.store;
    el('storeLogo').value = '';
    toast('Identitas toko tersimpan');
  } catch (error) { toast(error.message); }
}

function renderCategoryOptions() {
  const selected = el('productCategory').value;
  const active = state.data.categories.filter(item => item.isActive);
  el('productCategory').innerHTML = active.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  if (active.some(item => item.name === selected)) el('productCategory').value = selected;
}

function renderProducts() {
  el('productCount').textContent = state.data.products.length;
  el('productList').innerHTML = state.data.products.length ? state.data.products.map(product => `
    <div class="master-row ${product.isActive ? '' : 'inactive'}">
      <img class="master-thumb" src="${escapeHtml(product.imageData || '/default-product.svg')}" alt="${escapeHtml(product.name)}" />
      <div class="master-main">
        <strong>${escapeHtml(product.name)}</strong>
        <div class="master-meta">${escapeHtml(product.category)} · ${product.isActive ? 'Aktif' : 'Nonaktif'}</div>
        <div class="master-prices"><span>Beli ${rupiah(product.purchasePrice)}</span><span>Jual <b>${rupiah(product.price)}</b></span></div>
      </div>
      <div class="master-actions">
        <button class="mini-btn" data-edit-product="${product.id}" type="button">Edit</button>
        <button class="mini-btn danger" data-delete-product="${product.id}" type="button">Nonaktifkan</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada barang.</div>';
  document.querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => editProduct(Number(button.dataset.editProduct))));
  document.querySelectorAll('[data-delete-product]').forEach(button => button.addEventListener('click', () => deactivateProduct(Number(button.dataset.deleteProduct))));
}

function editProduct(id) {
  const product = state.data.products.find(item => item.id === id);
  if (!product) return;
  el('productId').value = product.id;
  el('productName').value = product.name;
  el('productPurchasePrice').value = product.purchasePrice;
  el('productPrice').value = product.price;
  if (![...el('productCategory').options].some(option => option.value === product.category)) {
    el('productCategory').insertAdjacentHTML('beforeend', `<option value="${escapeHtml(product.category)}">${escapeHtml(product.category)}</option>`);
  }
  el('productCategory').value = product.category;
  el('productActive').checked = product.isActive;
  state.productImageData = product.imageData || '';
  el('productImagePreview').src = state.productImageData || '/default-product.svg';
  el('productFormTitle').textContent = 'Edit barang';
  el('productCancelEdit').classList.remove('hidden');
  switchTab('products');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function previewProductImage() {
  try {
    const file = el('productImage').files[0];
    if (!file) return;
    state.productImageData = await imageFileToDataUrl(file, 800, .76);
    el('productImagePreview').src = state.productImageData;
  } catch (error) { toast(error.message); }
}

async function saveProduct(event) {
  event.preventDefault();
  const id = Number(el('productId').value || 0);
  const payload = {
    name: el('productName').value,
    purchasePrice: Number(el('productPurchasePrice').value),
    price: Number(el('productPrice').value),
    category: el('productCategory').value,
    emoji: '🥞',
    imageData: state.productImageData,
    isActive: el('productActive').checked
  };
  try {
    await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    await refreshData();
    resetProductForm();
    toast(id ? 'Barang diperbarui' : 'Barang ditambahkan');
  } catch (error) { toast(error.message); }
}

async function deactivateProduct(id) {
  if (!confirm('Nonaktifkan barang ini dari menu customer?')) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    await refreshData();
    toast('Barang dinonaktifkan');
  } catch (error) { toast(error.message); }
}

function resetProductForm() {
  el('productForm').reset();
  el('productId').value = '';
  el('productActive').checked = true;
  state.productImageData = '';
  el('productImagePreview').src = '/default-product.svg';
  el('productFormTitle').textContent = 'Tambah barang';
  el('productCancelEdit').classList.add('hidden');
  renderCategoryOptions();
}

function renderCategories() {
  el('categoryCount').textContent = state.data.categories.length;
  el('categoryList').innerHTML = state.data.categories.length ? state.data.categories.map(category => `
    <div class="master-row contact-row ${category.isActive ? '' : 'inactive'}">
      <div class="master-main"><strong>${escapeHtml(category.name)}</strong><div class="master-meta">${category.isActive ? 'Aktif' : 'Nonaktif'}</div></div>
      <div class="master-actions"><button class="mini-btn" data-edit-category="${category.id}" type="button">Edit</button><button class="mini-btn danger" data-delete-category="${category.id}" type="button">Nonaktifkan</button></div>
    </div>`).join('') : '<div class="empty">Belum ada kategori.</div>';
  document.querySelectorAll('[data-edit-category]').forEach(button => button.addEventListener('click', () => editCategory(Number(button.dataset.editCategory))));
  document.querySelectorAll('[data-delete-category]').forEach(button => button.addEventListener('click', () => deactivateCategory(Number(button.dataset.deleteCategory))));
}

function editCategory(id) {
  const category = state.data.categories.find(item => item.id === id);
  if (!category) return;
  el('categoryId').value = category.id;
  el('categoryName').value = category.name;
  el('categoryActive').checked = category.isActive;
  el('categoryFormTitle').textContent = 'Edit kategori';
  el('categoryCancelEdit').classList.remove('hidden');
}

async function saveCategory(event) {
  event.preventDefault();
  const id = Number(el('categoryId').value || 0);
  try {
    await api(id ? `/api/admin/categories/${id}` : '/api/admin/categories', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify({ name: el('categoryName').value, isActive: el('categoryActive').checked })
    });
    await refreshData();
    resetCategoryForm();
    toast(id ? 'Kategori diperbarui' : 'Kategori ditambahkan');
  } catch (error) { toast(error.message); }
}

async function deactivateCategory(id) {
  if (!confirm('Nonaktifkan kategori ini? Produk tetap tersimpan.')) return;
  try {
    await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
    await refreshData();
    toast('Kategori dinonaktifkan');
  } catch (error) { toast(error.message); }
}

function resetCategoryForm() {
  el('categoryForm').reset();
  el('categoryId').value = '';
  el('categoryActive').checked = true;
  el('categoryFormTitle').textContent = 'Tambah kategori';
  el('categoryCancelEdit').classList.add('hidden');
}

function renderContacts() {
  el('contactCount').textContent = state.data.contacts.length;
  el('contactList').innerHTML = state.data.contacts.length ? state.data.contacts.map(contact => `
    <div class="master-row contact-row">
      <div class="master-main">
        <strong>${escapeHtml(contact.name)}</strong>
        <div class="master-meta">${escapeHtml([contact.phone, contact.email].filter(Boolean).join(' · ') || 'Tanpa kontak')}</div>
        ${contact.notes ? `<div class="master-meta">${escapeHtml(contact.notes)}</div>` : ''}
      </div>
      <div class="master-actions"><button class="mini-btn" data-edit-contact="${escapeHtml(contact.id)}" type="button">Edit</button><button class="mini-btn danger" data-delete-contact="${escapeHtml(contact.id)}" type="button">Hapus</button></div>
    </div>`).join('') : '<div class="empty">Belum ada customer/contact.</div>';
  document.querySelectorAll('[data-edit-contact]').forEach(button => button.addEventListener('click', () => editContact(button.dataset.editContact)));
  document.querySelectorAll('[data-delete-contact]').forEach(button => button.addEventListener('click', () => deleteContact(button.dataset.deleteContact)));
}

function editContact(id) {
  const contact = state.data.contacts.find(item => item.id === id);
  if (!contact) return;
  el('contactId').value = contact.id;
  el('contactName').value = contact.name;
  el('contactPhone').value = contact.phone;
  el('contactEmail').value = contact.email;
  el('contactNotes').value = contact.notes;
  el('contactFormTitle').textContent = 'Edit customer/contact';
  el('contactCancelEdit').classList.remove('hidden');
}

async function saveContact(event) {
  event.preventDefault();
  const id = el('contactId').value;
  try {
    await api(id ? `/api/admin/contacts/${encodeURIComponent(id)}` : '/api/admin/contacts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify({ name: el('contactName').value, phone: el('contactPhone').value, email: el('contactEmail').value, notes: el('contactNotes').value })
    });
    await refreshData();
    resetContactForm();
    toast(id ? 'Customer diperbarui' : 'Customer ditambahkan');
  } catch (error) { toast(error.message); }
}

async function deleteContact(id) {
  if (!confirm('Hapus customer/contact ini?')) return;
  try {
    await api(`/api/admin/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshData();
    toast('Customer dihapus');
  } catch (error) { toast(error.message); }
}

function resetContactForm() {
  el('contactForm').reset();
  el('contactId').value = '';
  el('contactFormTitle').textContent = 'Tambah customer/contact';
  el('contactCancelEdit').classList.add('hidden');
}

async function refreshData() {
  state.data = await api('/api/admin/bootstrap');
  renderAll();
}

init().catch(error => {
  el('authMessage').textContent = error.message || 'Admin gagal dimuat.';
});
