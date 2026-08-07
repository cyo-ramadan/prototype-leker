const state = { orders: [] };
const el = id => document.getElementById(id);
const rupiah = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const escapeHtml = (str='') => String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const ORDER_POLL_INTERVAL_MS = 5000;

async function init() {
  await loadOrders();
  startOrderPolling();
  el('resetBtn').onclick = async () => {
    if (!confirm('Hapus semua order test?')) return;
    await fetch('/api/reset', { method: 'POST' });
  };
}

async function loadOrders() {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error(`Gagal memuat order (${res.status})`);
  state.orders = await res.json();
  render();
}

function startOrderPolling() {
  setInterval(() => {
    if (document.hidden) return;
    loadOrders().catch(() => {});
  }, ORDER_POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadOrders().catch(() => {});
  });
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
  el('doneList').innerHTML = groups.DONE.length ? groups.DONE.slice(0,20).map(o => `<div class="done-row"><span><b>${o.orderNo}</b> · ${escapeHtml(o.customerName)} · ${o.status}</span><span>${rupiah(o.total)}</span></div>`).join('') : `<div class="muted">Belum ada riwayat.</div>`;
  document.querySelectorAll('[data-status]').forEach(btn => btn.onclick = () => updateStatus(btn.dataset.id, btn.dataset.status));
}

function renderGroup(orders, status) {
  if (!orders.length) return `<div class="empty">Queue kosong.</div>`;
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
  const res = await fetch(`/api/orders/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Gagal update status');
    return;
  }
  upsert(data);
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

init();
