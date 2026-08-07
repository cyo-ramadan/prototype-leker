const rupiah = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const state = { menu: [], cart: [], category: 'Semua', activeOrder: null };
const ORDER_POLL_INTERVAL_MS = 5000;

const el = id => document.getElementById(id);

async function loadMenu() {
  try {
    const apiRes = await fetch('/api/menu', { cache: 'no-store' });
    if (apiRes.ok) return await apiRes.json();
  } catch {}

  const fallbackRes = await fetch('/menu.json', { cache: 'force-cache' });
  if (!fallbackRes.ok) throw new Error('Menu belum bisa dimuat.');
  return fallbackRes.json();
}

async function init() {
  state.menu = await loadMenu();
  renderCategories();
  renderMenu();
  renderCart();
  bindInputs();
  startOrderPolling();

  const activeId = localStorage.getItem('lekerActiveOrderId');
  if (activeId) {
    try {
      const res = await fetch(`/api/orders/${activeId}`);
      if (res.ok) {
        state.activeOrder = await res.json();
        showStatus(state.activeOrder);
      } else if (res.status !== 429) {
        localStorage.removeItem('lekerActiveOrderId');
      }
    } catch {}
  }
}

function renderCategories() {
  const categories = ['Semua', ...new Set(state.menu.map(m => m.category))];
  el('categoryRow').innerHTML = categories.map(c => `<button class="category-btn ${c === state.category ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('');
  document.querySelectorAll('.category-btn').forEach(btn => btn.onclick = () => {
    state.category = btn.dataset.cat;
    renderCategories();
    renderMenu();
  });
}

function renderMenu() {
  const filtered = state.category === 'Semua' ? state.menu : state.menu.filter(m => m.category === state.category);
  el('menuGrid').innerHTML = filtered.map(m => `
    <article class="menu-card">
      <div class="menu-emoji">${m.emoji}</div>
      <h3>${m.name}</h3>
      <div class="category">${m.category}</div>
      <div class="bottom"><span class="price">${rupiah(m.price)}</span><button class="add-btn" data-id="${m.id}">+</button></div>
    </article>`).join('');
  document.querySelectorAll('.add-btn').forEach(btn => btn.onclick = () => addItem(Number(btn.dataset.id)));
}

function addItem(menuId) {
  const existing = state.cart.find(i => i.menuId === menuId);
  if (existing) existing.qty++;
  else state.cart.push({ menuId, qty: 1, note: '' });
  renderCart();
}

function changeQty(menuId, delta) {
  const item = state.cart.find(i => i.menuId === menuId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(i => i.menuId !== menuId);
  renderCart();
}

function renderCart() {
  if (!state.cart.length) {
    el('cartList').innerHTML = `<div class="empty">Belum ada leker yang dipilih.</div>`;
  } else {
    el('cartList').innerHTML = state.cart.map(item => {
      const menu = state.menu.find(m => m.id === item.menuId);
      return `<div class="cart-item">
        <div class="cart-item-head"><h4>${menu.name}</h4><b>${rupiah(menu.price * item.qty)}</b></div>
        <div class="qty-row"><button class="qty-btn" data-action="minus" data-id="${menu.id}">−</button><b>${item.qty}</b><button class="qty-btn" data-action="plus" data-id="${menu.id}">+</button></div>
        <input class="note-input" data-note-id="${menu.id}" value="${escapeHtml(item.note)}" placeholder="Catatan item, contoh: tipis & crispy" maxlength="120" />
      </div>`;
    }).join('');
  }
  document.querySelectorAll('[data-action]').forEach(btn => btn.onclick = () => changeQty(Number(btn.dataset.id), btn.dataset.action === 'plus' ? 1 : -1));
  document.querySelectorAll('[data-note-id]').forEach(inp => inp.oninput = () => {
    const item = state.cart.find(i => i.menuId === Number(inp.dataset.noteId));
    if (item) item.note = inp.value;
  });
  const total = state.cart.reduce((sum, item) => {
    const menu = state.menu.find(m => m.id === item.menuId);
    return sum + menu.price * item.qty;
  }, 0);
  el('cartTotal').textContent = rupiah(total);
  el('checkoutBtn').disabled = state.cart.length === 0;
}

function bindInputs() {
  el('checkoutBtn').onclick = submitOrder;
  el('readyButton').onclick = () => alert('Pesanan siap. Silakan menuju kasir dan sebutkan nomor pesanan.');
  el('newOrderBtn').onclick = resetKiosk;
}

async function submitOrder() {
  el('checkoutBtn').disabled = true;
  el('checkoutBtn').textContent = 'Mengirim pesanan...';
  try {
    const payload = {
      customerName: el('customerName').value,
      tableLabel: el('tableLabel').value,
      generalNote: el('generalNote').value,
      items: state.cart
    };
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    if (!res.ok) {
      if (res.status === 429) throw new Error('Server order sedang kena limit sementara. Menu dan cart tetap bisa dites, lalu coba kirim lagi setelah quota reset.');
      throw new Error(data.error || `Gagal mengirim pesanan (${res.status})`);
    }
    state.activeOrder = data;
    localStorage.setItem('lekerActiveOrderId', data.id);
    showStatus(data);
  } catch (err) {
    alert(err.message);
    el('checkoutBtn').disabled = false;
  } finally {
    el('checkoutBtn').textContent = 'OK, kirim ke kasir';
  }
}

function showStatus(order) {
  el('shopView').classList.add('hidden');
  el('statusView').classList.remove('hidden');
  el('statusOrderNo').textContent = order.orderNo;

  ['stepNew','stepPrep','stepReady'].forEach(id => el(id).classList.remove('active'));
  el('stepNew').classList.add('active');
  el('statusCard').classList.remove('ready');
  el('readyButton').classList.add('hidden');
  el('newOrderBtn').classList.add('hidden');

  if (order.status === 'NEW') {
    el('statusIcon').textContent = '🧾';
    el('statusTitle').textContent = 'Pesanan diterima';
    el('statusText').textContent = 'Kasir sudah menerima order. Customer boleh meninggalkan booth sementara.';
  }
  if (order.status === 'PREPARING') {
    el('stepPrep').classList.add('active');
    el('statusIcon').textContent = '🥞';
    el('statusTitle').textContent = 'Lagi dibuat';
    el('statusText').textContent = 'Tim sedang menyiapkan leker. Nomor pesanan ini tetap tersimpan meskipun browser direfresh.';
  }
  if (order.status === 'READY') {
    el('stepPrep').classList.add('active');
    el('stepReady').classList.add('active');
    el('statusCard').classList.add('ready');
    el('statusIcon').textContent = '✓';
    el('statusTitle').textContent = 'Pesanan sudah jadi!';
    el('statusText').textContent = 'Silakan menuju kasir dan tunjukkan nomor pesanan ini.';
    el('readyButton').classList.remove('hidden');
  }
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
    el('statusIcon').textContent = order.status === 'COMPLETED' ? '🎉' : '✕';
    el('statusTitle').textContent = order.status === 'COMPLETED' ? 'Pesanan selesai' : 'Pesanan dibatalkan';
    el('statusText').textContent = order.status === 'COMPLETED' ? 'Terima kasih. Kiosk siap dipakai untuk order berikutnya.' : 'Silakan hubungi kasir jika perlu bantuan.';
    el('newOrderBtn').classList.remove('hidden');
  }
}

function resetKiosk() {
  state.cart = [];
  state.activeOrder = null;
  localStorage.removeItem('lekerActiveOrderId');
  el('customerName').value = '';
  el('generalNote').value = '';
  el('statusView').classList.add('hidden');
  el('shopView').classList.remove('hidden');
  renderCart();
}

async function refreshActiveOrder() {
  if (!state.activeOrder || document.hidden) return;
  try {
    const res = await fetch(`/api/orders/${state.activeOrder.id}`, { cache: 'no-store' });
    if (!res.ok) return;
    const order = await res.json();
    if (order.updatedAt !== state.activeOrder.updatedAt || order.status !== state.activeOrder.status) {
      state.activeOrder = order;
      showStatus(order);
    }
  } catch {}
}

function startOrderPolling() {
  setInterval(refreshActiveOrder, ORDER_POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshActiveOrder();
  });
}

function escapeHtml(str='') {
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}

init().catch(err => {
  console.error('Prototype Leker customer init failed', err);
  el('menuGrid').innerHTML = `<div class="empty">${escapeHtml(err.message || 'UI gagal dimuat.')}</div>`;
});
