const state = {
  orders: [],
  products: [],
  draft: new Map(),
  selectedCategory: 'Semua',
  token: sessionStorage.getItem('lekerCashierToken') || '',
  cashier: null,
  drawer: null,
  canWrite: false,
  poller: null,
  visibilityBound: false,
  dialogSubmit: null
};

const el = id => document.getElementById(id);
const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
const ORDER_POLL_INTERVAL_MS = 5000;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request gagal (${response.status})`);
    error.status = response.status;
    error.code = data.code;
    error.payload = data;
    throw error;
  }
  return data;
}

function toast(message) {
  let node = document.getElementById('cashierToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'cashierToast';
    Object.assign(node.style, {
      position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)', zIndex: '120',
      background: '#281f18', color: 'white', borderRadius: '999px', padding: '10px 14px', fontWeight: '900', fontSize: '12px'
    });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 1900);
}

async function init() {
  el('cashierLoginForm').addEventListener('submit', login);
  el('logoutBtn').addEventListener('click', logout);
  el('openDrawerBtn').addEventListener('click', openDrawerDialog);
  el('closeDrawerBtn').addEventListener('click', closeDrawerDialog);
  el('purchaseBtn').addEventListener('click', purchaseDialog);
  el('expenseBtn').addEventListener('click', () => moneyMovementDialog('expense'));
  el('otherIncomeBtn').addEventListener('click', () => moneyMovementDialog('income'));
  el('processSaleBtn').addEventListener('click', processSale);
  el('cashierDialogCancel').addEventListener('click', closeDialog);
  el('cashierDialogClose').addEventListener('click', closeDialog);
  el('cashierDialogForm').addEventListener('submit', submitDialog);
  el('cashierDialog').addEventListener('cancel', () => { state.dialogSubmit = null; });

  if (state.token) {
    try {
      const payload = await api('/api/cashier/me');
      state.cashier = payload.cashier;
      await openDashboard();
      return;
    } catch {
      clearSession();
    }
  }
  showLogin();
}

async function login(event) {
  event.preventDefault();
  el('cashierLoginMessage').textContent = '';
  try {
    const payload = await api('/api/cashier/login', {
      method: 'POST',
      body: JSON.stringify({ username: el('cashierUsername').value, password: el('cashierPassword').value })
    });
    state.token = payload.token;
    state.cashier = payload.cashier;
    sessionStorage.setItem('lekerCashierToken', state.token);
    el('cashierPassword').value = '';
    await openDashboard();
  } catch (error) {
    el('cashierLoginMessage').textContent = error.message;
  }
}

async function logout() {
  try { if (state.token) await api('/api/cashier/logout', { method: 'POST' }); } catch {}
  clearSession();
  showLogin();
}

function clearSession() {
  state.token = '';
  state.cashier = null;
  state.orders = [];
  state.products = [];
  state.draft.clear();
  state.drawer = null;
  state.canWrite = false;
  sessionStorage.removeItem('lekerCashierToken');
  if (state.poller) clearInterval(state.poller);
  state.poller = null;
}

function showLogin() {
  el('cashierLoginView').classList.remove('hidden');
  el('cashierDashboard').classList.add('hidden');
  el('cashierTopActions').classList.add('hidden');
  el('cashierBrandSub').textContent = 'Cashier Login';
  setTimeout(() => el('cashierUsername').focus(), 50);
}

async function openDashboard() {
  const cashier = state.cashier;
  el('cashierLoginView').classList.add('hidden');
  el('cashierDashboard').classList.remove('hidden');
  el('cashierTopActions').classList.remove('hidden');
  el('cashierBrandSub').textContent = `Cashier · ${cashier.store.code}`;
  el('cashierIdentity').textContent = `${cashier.employeeName} · ${cashier.store.code}`;
  el('cashierStoreLabel').textContent = `${cashier.store.code} · ${cashier.store.storeName}`;
  el('openKioskLink').href = `/s/${encodeURIComponent(cashier.store.code)}/customer`;
  await Promise.all([loadMenu(), loadDrawer(), loadOrders()]);
  renderDraft();
  startPolling();
}

async function loadMenu() {
  const payload = await api('/api/cashier/menu');
  state.products = payload.products || [];
  renderMenu();
}

function renderMenu() {
  const categories = ['Semua', ...new Set(state.products.map(product => product.category).filter(Boolean))];
  if (!categories.includes(state.selectedCategory)) state.selectedCategory = 'Semua';
  el('cashierCategoryRow').innerHTML = categories.map(category => `<button class="cashier-category-btn ${category === state.selectedCategory ? 'active' : ''}" data-cashier-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>`).join('');
  document.querySelectorAll('[data-cashier-category]').forEach(button => button.onclick = () => {
    state.selectedCategory = button.dataset.cashierCategory;
    renderMenu();
  });

  const filtered = state.selectedCategory === 'Semua' ? state.products : state.products.filter(product => product.category === state.selectedCategory);
  el('cashierMenuCount').textContent = state.products.length;
  el('cashierMenuGrid').innerHTML = filtered.length ? filtered.map(product => `
    <article class="cashier-menu-card">
      <img class="cashier-menu-image" src="${escapeHtml(product.imageData || '/default-product.svg')}" alt="${escapeHtml(product.name)}" />
      <div class="cashier-menu-body">
        <div class="cashier-menu-name">${escapeHtml(product.name)}</div>
        <div class="cashier-menu-meta">${escapeHtml(product.category || '')}</div>
        <div class="cashier-menu-price">${rupiah(product.price)}</div>
        <button class="cashier-add-btn" data-add-product="${product.id}" type="button">＋ Tambah</button>
      </div>
    </article>`).join('') : '<div class="empty">Belum ada barang aktif di gerai ini.</div>';
  document.querySelectorAll('[data-add-product]').forEach(button => button.onclick = () => changeDraft(Number(button.dataset.addProduct), 1));
}

// Fulfillment mode for a sale line: Dadakan (auto-produksi dari resep yang
// di-link, baru terjual) atau Biasa/STOCK (jual dari stok barang jadi).
// Defaultnya Dadakan begitu barangnya punya resep terhubung -- kasir bisa
// menggantinya ke Biasa per baris lewat toggle di draft.
function defaultProductionMode(product) {
  return product?.recipeLinkEnabled ? 'DADAKAN' : undefined;
}

function changeDraft(productId, delta) {
  const product = state.products.find(item => Number(item.id) === Number(productId));
  if (!product) return;
  const current = state.draft.get(Number(productId)) || { product, quantity: 0, productionMode: defaultProductionMode(product) };
  const quantity = Math.max(0, Math.min(50, current.quantity + delta));
  if (!quantity) state.draft.delete(Number(productId));
  else state.draft.set(Number(productId), { ...current, product, quantity });
  renderDraft();
}

function toggleDraftProductionMode(productId) {
  const line = state.draft.get(Number(productId));
  if (!line || !line.product.recipeLinkEnabled) return;
  line.productionMode = line.productionMode === 'STOCK' ? 'DADAKAN' : 'STOCK';
  renderDraft();
}

function renderDraft() {
  const lines = [...state.draft.values()].reverse();
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0);
  el('draftCount').textContent = totalQty;
  el('draftTotal').textContent = rupiah(total);
  el('cashierDraftList').innerHTML = lines.length ? lines.map(line => `
    <div class="cashier-draft-row">
      <div><strong>${escapeHtml(line.product.name)}</strong><small>${rupiah(line.product.price)} · ${rupiah(Number(line.product.price) * line.quantity)}</small>${draftModeToggleHtml(line)}</div>
      <div class="cashier-draft-controls"><button type="button" data-draft-minus="${line.product.id}">−</button><span>${line.quantity}</span><button type="button" data-draft-plus="${line.product.id}">＋</button></div>
    </div>`).join('') : '<div class="cashier-draft-empty">Belum ada menu dipilih.</div>';
  document.querySelectorAll('[data-draft-minus]').forEach(button => button.onclick = () => changeDraft(Number(button.dataset.draftMinus), -1));
  document.querySelectorAll('[data-draft-plus]').forEach(button => button.onclick = () => changeDraft(Number(button.dataset.draftPlus), 1));
  document.querySelectorAll('[data-draft-mode]').forEach(button => button.onclick = () => toggleDraftProductionMode(Number(button.dataset.draftMode)));
  el('processSaleBtn').disabled = !state.canWrite || !lines.length;
}

function draftModeToggleHtml(line) {
  if (!line.product.recipeLinkEnabled) return '';
  const isBiasa = line.productionMode === 'STOCK';
  return `<button type="button" class="mini-btn" data-draft-mode="${line.product.id}" title="Klik untuk ganti">${isBiasa ? 'Biasa (stok jadi)' : 'Dadakan (produksi dari resep)'}</button>`;
}

async function loadDrawer() {
  const payload = await api('/api/cashier/drawer');
  state.cashier = payload.cashier || state.cashier;
  state.drawer = payload.drawer || null;
  state.canWrite = Boolean(payload.canWrite);
  renderDrawer();
  renderOrders();
  renderDraft();
}

function renderDrawer() {
  const drawer = state.drawer;
  const badge = el('drawerModeBadge');
  badge.classList.remove('write', 'occupied');
  if (!drawer) {
    el('drawerTitle').textContent = 'Laci belum dibuka';
    el('drawerStatusText').textContent = 'Buka laci untuk mulai mencatat transaksi gerai.';
    badge.textContent = 'READ ONLY';
    el('openDrawerBtn').disabled = false;
    el('openDrawerBtn').classList.remove('hidden');
    el('closeDrawerBtn').classList.add('hidden');
  } else if (state.canWrite) {
    el('drawerTitle').textContent = `Laci aktif · ${drawer.cashierName}`;
    el('drawerStatusText').textContent = `Dibuka ${formatDateTime(drawer.openedAt)} · Saldo awal ${rupiah(drawer.openingAmount)}`;
    badge.textContent = 'WRITE MODE';
    badge.classList.add('write');
    el('openDrawerBtn').classList.add('hidden');
    el('closeDrawerBtn').classList.remove('hidden');
  } else {
    el('drawerTitle').textContent = `Laci dipegang ${drawer.cashierName}`;
    el('drawerStatusText').textContent = `Akun ${state.cashier.employeeName} tetap bisa melihat menu dan order, tetapi perubahan data dikunci.`;
    badge.textContent = 'READ ONLY';
    badge.classList.add('occupied');
    el('openDrawerBtn').classList.remove('hidden');
    el('openDrawerBtn').disabled = true;
    el('closeDrawerBtn').classList.add('hidden');
  }

  const purchaseButton = el('purchaseBtn');
  purchaseButton.disabled = false;
  purchaseButton.title = state.canWrite
    ? 'Catat pembelian bahan'
    : drawer
      ? `Read-only: laci sedang dipegang ${drawer.cashierName}`
      : 'Buka laci untuk mencatat pembelian bahan';
  ['expenseBtn','otherIncomeBtn'].forEach(id => { el(id).disabled = !state.canWrite; });
  el('drawerDetailsBtn').disabled = !drawer;
  el('reportsBtn').disabled = !drawer;
  el('cashierWriteLockNote').textContent = state.canWrite
    ? `Write mode aktif atas nama ${state.cashier.employeeName}. Semua transaksi tercatat ke ${state.cashier.store.code}.`
    : drawer
      ? `Read-only. Laci sedang dipegang ${drawer.cashierName}.`
      : 'Buka laci untuk mengaktifkan write mode.';
  el('cashierWriteLockNote').classList.toggle('write', state.canWrite);
}

async function loadOrders() {
  try {
    const payload = await api('/api/cashier/orders');
    state.cashier = payload.cashier;
    state.orders = payload.orders || [];
    renderOrders();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      showLogin();
      return;
    }
    throw error;
  }
}

function startPolling() {
  if (state.poller) clearInterval(state.poller);
  state.poller = setInterval(() => {
    if (document.hidden || !state.token) return;
    Promise.all([loadOrders(), loadDrawer()]).catch(() => {});
  }, ORDER_POLL_INTERVAL_MS);

  if (!state.visibilityBound) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.token) Promise.all([loadOrders(), loadDrawer()]).catch(() => {});
    });
    state.visibilityBound = true;
  }
}

function renderOrders() {
  if (!el('statNew')) return;
  const groups = {
    NEW: state.orders.filter(order => order.status === 'NEW'),
    PREPARING: state.orders.filter(order => order.status === 'PREPARING'),
    READY: state.orders.filter(order => order.status === 'READY'),
    DONE: state.orders.filter(order => ['COMPLETED','CANCELLED'].includes(order.status))
  };
  el('statNew').textContent = groups.NEW.length;
  el('statPrep').textContent = groups.PREPARING.length;
  el('statReady').textContent = groups.READY.length;
  el('badgeNew').textContent = groups.NEW.length;
  el('badgePrep').textContent = groups.PREPARING.length;
  el('badgeReady').textContent = groups.READY.length;
  el('colNew').innerHTML = renderOrderGroup(groups.NEW, 'NEW');
  el('colPrep').innerHTML = renderOrderGroup(groups.PREPARING, 'PREPARING');
  el('colReady').innerHTML = renderOrderGroup(groups.READY, 'READY');
  el('doneList').innerHTML = groups.DONE.length ? groups.DONE.slice(0,20).map(order => `<div class="done-row"><span><b>${escapeHtml(order.orderNo)}</b> · ${escapeHtml(order.customerName)} · ${escapeHtml(order.status)}</span><span>${rupiah(order.total)}</span></div>`).join('') : '<div class="muted">Belum ada riwayat.</div>';
  document.querySelectorAll('[data-status]').forEach(button => button.onclick = () => updateStatus(button.dataset.id, button.dataset.status));
}

function renderOrderGroup(orders, status) {
  if (!orders.length) return '<div class="empty">Queue kosong.</div>';
  const disabled = state.canWrite ? '' : 'disabled title="Buka laci atau tunggu pemegang laci"';
  return orders.map(order => {
    const actions = status === 'NEW'
      ? `<button class="action-btn action-prep" ${disabled} data-id="${escapeHtml(order.id)}" data-status="PREPARING">Mulai Buat</button><button class="action-btn action-cancel" ${disabled} data-id="${escapeHtml(order.id)}" data-status="CANCELLED">Batal</button>`
      : status === 'PREPARING'
      ? `<button class="action-btn action-ready" ${disabled} data-id="${escapeHtml(order.id)}" data-status="READY">Pesanan Siap</button>`
      : `<button class="action-btn action-done" ${disabled} data-id="${escapeHtml(order.id)}" data-status="COMPLETED">Sudah Diambil</button>`;

    return `<article class="order-card ${status === 'READY' ? 'ready' : ''}">
      <div class="order-top"><div><h3>${escapeHtml(order.orderNo)}</h3><div class="customer-meta">${escapeHtml(order.customerName)} · ${escapeHtml(order.tableLabel)}</div></div><div class="time">${formatTime(order.createdAt)}</div></div>
      <ul class="order-items">${order.items.map(item => `<li><b>${item.qty}×</b> ${escapeHtml(item.name)} <span style="float:right">${rupiah(item.lineTotal ?? item.price*item.qty)}</span>${item.note ? `<div class="item-note">↳ ${escapeHtml(item.note)}</div>` : ''}</li>`).join('')}</ul>
      ${order.generalNote ? `<div class="general-note"><b>Catatan umum:</b> ${escapeHtml(order.generalNote)}</div>` : ''}
      <div class="order-total"><span>Total</span><span>${rupiah(order.total)}</span></div>
      <div class="actions">${actions}</div>
    </article>`;
  }).join('');
}

async function updateStatus(id, status) {
  try {
    const data = await api(`/api/cashier/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const index = state.orders.findIndex(order => order.id === data.id);
    if (index >= 0) state.orders[index] = data;
    renderOrders();
  } catch (error) {
    toast(error.message);
    await loadDrawer().catch(() => {});
  }
}

async function processSale() {
  if (!state.canWrite || !state.draft.size) return;
  try {
    const payload = await api('/api/cashier/sales', {
      method: 'POST',
      body: JSON.stringify({
        customerName: el('saleCustomerName').value,
        note: el('saleNote').value,
        items: [...state.draft.values()].map(line => ({ productId: line.product.id, quantity: line.quantity, productionMode: line.productionMode }))
      })
    });
    state.draft.clear();
    el('saleCustomerName').value = '';
    el('saleNote').value = '';
    renderDraft();
    toast(`Penjualan tersimpan · ${rupiah(payload.sale.total)}`);
  } catch (error) {
    toast(error.message);
    await loadDrawer().catch(() => {});
  }
}

function openDialog({ eyebrow = 'Laci', title, body, submitText = 'Simpan', onSubmit = null, readOnly = false }) {
  el('cashierDialogEyebrow').textContent = eyebrow;
  el('cashierDialogTitle').textContent = title;
  el('cashierDialogBody').innerHTML = body;
  el('cashierDialogSubmit').textContent = submitText;
  el('cashierDialogSubmit').classList.toggle('hidden', readOnly);
  // The dialog element and its submit button are a single shared instance reused
  // by every dialog type. submitDialog() re-enables it in a finally block, but a
  // dialog dismissed via the native ESC key / backdrop click (a `cancel` event,
  // handled below) skips that path entirely -- reset explicitly on every open so
  // a stuck disabled state from a previous dialog can never carry over here.
  el('cashierDialogSubmit').disabled = false;
  el('cashierDialogCancel').textContent = readOnly ? 'Tutup' : 'Batal';
  state.dialogSubmit = onSubmit;
  el('cashierDialog').showModal();
}

function closeDialog() {
  state.dialogSubmit = null;
  el('cashierDialog').close();
}

async function submitDialog(event) {
  event.preventDefault();
  if (!state.dialogSubmit) return closeDialog();
  const submit = el('cashierDialogSubmit');
  submit.disabled = true;
  try {
    const done = await state.dialogSubmit();
    if (done !== false) closeDialog();
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
}

function openDrawerDialog() {
  openDialog({
    eyebrow: state.cashier?.store.code || 'Gerai',
    title: 'Buka Laci',
    body: '<div class="field"><label>Saldo awal laci</label><input id="dialogOpeningAmount" class="text-input" type="number" min="0" step="1" value="0" required /></div><p class="muted">Kasir yang membuka laci menjadi pemegang write mode untuk gerai ini sampai laci ditutup.</p>',
    submitText: 'BUKA LACI',
    onSubmit: async () => {
      await api('/api/cashier/drawer/open', { method: 'POST', body: JSON.stringify({ openingAmount: Number(el('dialogOpeningAmount').value) }) });
      await loadDrawer();
      toast('Laci dibuka');
      return true;
    }
  });
}

function closeDrawerDialog() {
  openDialog({
    eyebrow: state.cashier?.store.code || 'Gerai',
    title: 'Tutup Laci',
    body: '<div class="field"><label>Saldo kas fisik saat tutup</label><input id="dialogClosingAmount" class="text-input" type="number" min="0" step="1" required /></div><p class="muted">Setelah laci ditutup, kasir lain di gerai ini bisa membuka laci berikutnya.</p>',
    submitText: 'TUTUP LACI',
    onSubmit: async () => {
      await api('/api/cashier/drawer/close', { method: 'POST', body: JSON.stringify({ closingAmount: Number(el('dialogClosingAmount').value) }) });
      await loadDrawer();
      toast('Laci ditutup');
      return true;
    }
  });
}

async function purchaseDialog() {
  try {
    const payload = await api('/api/cashier/suppliers');
    const suppliers = payload.suppliers || [];
    const options = ['<option value="">Tanpa supplier</option>', ...suppliers.map(supplier => `<option value="${escapeHtml(supplier.id)}">${escapeHtml(supplier.name)}</option>`)].join('');
    openDialog({
      eyebrow: 'Laci · Cash Out',
      title: 'Beli Bahan',
      body: `<div class="field"><label>Supplier</label><select id="dialogSupplier" class="text-input">${options}</select></div><div class="field"><label>Deskripsi pembelian</label><input id="dialogPurchaseDescription" class="text-input" maxlength="220" placeholder="Contoh: tepung dan susu" required /></div><div class="field"><label>Total pembelian</label><input id="dialogPurchaseAmount" class="text-input" type="number" min="1" step="1" required /></div><div class="field"><label>Catatan</label><textarea id="dialogPurchaseNote" rows="2" maxlength="500"></textarea></div><p class="muted">Catatan pembelian ini tidak mengubah stok resmi. Inventory tetap domain terpisah.</p>`,
      submitText: 'SIMPAN PEMBELIAN',
      onSubmit: async () => {
        await api('/api/cashier/purchases', { method: 'POST', body: JSON.stringify({ supplierId: el('dialogSupplier').value, description: el('dialogPurchaseDescription').value, totalAmount: Number(el('dialogPurchaseAmount').value), note: el('dialogPurchaseNote').value }) });
        toast('Pembelian bahan tersimpan');
        return true;
      }
    });
  } catch (error) { toast(error.message); }
}

function moneyMovementDialog(type) {
  const isExpense = type === 'expense';
  openDialog({
    eyebrow: isExpense ? 'Laci · Cash Out' : 'Laci · Cash In',
    title: isExpense ? 'Pengeluaran' : 'Pendapatan Lain',
    body: `<div class="field"><label>Deskripsi</label><input id="dialogMovementDescription" class="text-input" maxlength="220" required /></div><div class="field"><label>Nominal</label><input id="dialogMovementAmount" class="text-input" type="number" min="1" step="1" required /></div>`,
    submitText: isExpense ? 'SIMPAN PENGELUARAN' : 'SIMPAN PENDAPATAN',
    onSubmit: async () => {
      await api(isExpense ? '/api/cashier/expenses' : '/api/cashier/other-income', {
        method: 'POST',
        body: JSON.stringify({ description: el('dialogMovementDescription').value, amount: Number(el('dialogMovementAmount').value) })
      });
      toast(isExpense ? 'Pengeluaran tersimpan' : 'Pendapatan lain tersimpan');
      return true;
    }
  });
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

init();
