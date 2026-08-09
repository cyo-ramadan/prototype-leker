const state = {
  orders: [],
  token: sessionStorage.getItem('lekerCashierToken') || '',
  cashier: null,
  poller: null
};
const el = id => document.getElementById(id);
const rupiah = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const escapeHtml = (str='') => String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
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
    throw error;
  }
  return data;
}

async function init() {
  el('cashierLoginForm').addEventListener('submit', login);
  el('logoutBtn').addEventListener('click', logout);
  el('resetBtn').addEventListener('click', resetOrders);

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
      body: JSON.stringify({
        username: el('cashierUsername').value,
        password: el('cashierPassword').value
      })
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
  await loadOrders();
  startOrderPolling();
}

async function loadOrders() {
  try {
    const payload = await api('/api/cashier/orders');
    state.cashier = payload.cashier;
    state.orders = payload.orders || [];
    render();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      showLogin();
      return;
    }
    throw error;
  }
}

function startOrderPolling() {
  if (state.poller) clearInterval(state.poller);
  state.poller = setInterval(() => {
    if (document.hidden || !state.token) return;
    loadOrders().catch(() => {});
  }, ORDER_POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token) loadOrders().catch(() => {});
  }, { once: true });
}

function upsert(order) {
  const idx = state.orders.findIndex(o => o.id === order.id);
  if (idx >= 0) state.orders[idx] = order;
  else state.orders.unshift(order);
  render();
}

function render() {
  const groups = {
    NEW: state.orders.filter(o => o.status === 'NEW'),
    PREPARING: state.orders.filter(o => o.status === 'PREPARING'),
    READY: state.orders.filter(o => o.status === 'READY'),
    DONE: state.orders.filter(o => ['COMPLETED','CANCELLED'].includes(o.status))
  };
  el('statNew').textContent = groups.NEW.length;
  el('statPrep').textContent = groups.PREPARING.length;
  el('statReady').textContent = groups.READY.length;
  el('badgeNew').textContent = groups.NEW.length;
  el('badgePrep').textContent = groups.PREPARING.length;
  el('badgeReady').textContent = groups.READY.length;
  el('colNew').innerHTML = renderGroup(groups.NEW, 'NEW');
  el('colPrep').innerHTML = renderGroup(groups.PREPARING, 'PREPARING');
  el('colReady').innerHTML = renderGroup(groups.READY, 'READY');
  el('doneList').innerHTML = groups.DONE.length ? groups.DONE.slice(0,20).map(o => `<div class="done-row"><span><b>${o.orderNo}</b> · ${escapeHtml(o.customerName)} · ${o.status}</span><span>${rupiah(o.total)}</span></div>`).join('') : '<div class="muted">Belum ada riwayat.</div>';
  document.querySelectorAll('[data-status]').forEach(btn => btn.onclick = () => updateStatus(btn.dataset.id, btn.dataset.status));
}

function renderGroup(orders, status) {
  if (!orders.length) return '<div class="empty">Queue kosong.</div>';
  return orders.map(order => {
    const actions = status === 'NEW'
      ? `<button class="action-btn action-prep" data-id="${order.id}" data-status="PREPARING">Mulai Buat</button><button class="action-btn action-cancel" data-id="${order.id}" data-status="CANCELLED">Batal</button>`
      : status === 'PREPARING'
      ? `<button class="action-btn action-ready" data-id="${order.id}" data-status="READY">Pesanan Siap</button>`
      : `<button class="action-btn action-done" data-id="${order.id}" data-status="COMPLETED">Sudah Diambil</button>`;

    return `<article class="order-card ${status === 'READY' ? 'ready' : ''}">
      <div class="order-top"><div><h3>${order.orderNo}</h3><div class="customer-meta">${escapeHtml(order.customerName)} · ${escapeHtml(order.tableLabel)}</div></div><div class="time">${formatTime(order.createdAt)}</div></div>
      <ul class="order-items">${order.items.map(i => `<li><b>${i.qty}×</b> ${escapeHtml(i.name)} <span style="float:right">${rupiah(i.price*i.qty)}</span>${i.note ? `<div class="item-note">↳ ${escapeHtml(i.note)}</div>` : ''}</li>`).join('')}</ul>
      ${order.generalNote ? `<div class="general-note"><b>Catatan umum:</b> ${escapeHtml(order.generalNote)}</div>` : ''}
      <div class="order-total"><span>Total</span><span>${rupiah(order.total)}</span></div>
      <div class="actions">${actions}</div>
    </article>`;
  }).join('');
}

async function updateStatus(id, status) {
  try {
    const data = await api(`/api/cashier/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    upsert(data);
  } catch (error) {
    alert(error.message);
    if (error.status === 401) { clearSession(); showLogin(); }
  }
}

async function resetOrders() {
  if (!confirm(`Hapus semua order test di ${state.cashier?.store.code || 'gerai ini'}?`)) return;
  try {
    await api('/api/cashier/reset', { method: 'POST' });
    await loadOrders();
  } catch (error) { alert(error.message); }
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

init();
