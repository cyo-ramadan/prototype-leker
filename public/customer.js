const rupiah = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const state = { menu: [], cart: [], category: 'Semua', activeOrder: null, cartOpen: false };
const ORDER_POLL_INTERVAL_MS = 5000;
const CART_SWIPE_THRESHOLD_PX = 48;
const CART_EDGE_GESTURE_PX = 36;

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
  bindCartDrawer();
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
  el('menuGrid').innerHTML = filtered.map(menu => {
    const cartItem = state.cart.find(item => item.menuId === menu.id);
    const control = cartItem
      ? `<div class="menu-stepper" aria-label="${escapeHtml(menu.name)} dipilih ${cartItem.qty}">
          <button class="menu-stepper-btn" data-menu-action="minus" data-id="${menu.id}" aria-label="Kurangi ${escapeHtml(menu.name)}">−</button>
          <span class="menu-stepper-qty">${cartItem.qty}</span>
          <button class="menu-stepper-btn menu-stepper-plus" data-menu-action="plus" data-id="${menu.id}" aria-label="Tambah ${escapeHtml(menu.name)}">+</button>
        </div>`
      : `<button class="add-btn" data-menu-action="add" data-id="${menu.id}" aria-label="Tambah ${escapeHtml(menu.name)}">+</button>`;

    return `
      <article class="menu-card ${cartItem ? 'selected' : ''}">
        <div class="menu-card-top">
          <div class="menu-emoji">${menu.emoji}</div>
          ${cartItem ? `<span class="selected-badge">✓ ${cartItem.qty}</span>` : ''}
        </div>
        <h3>${menu.name}</h3>
        <div class="category">${menu.category}</div>
        <div class="bottom"><span class="price">${rupiah(menu.price)}</span>${control}</div>
      </article>`;
  }).join('');

  document.querySelectorAll('[data-menu-action]').forEach(btn => btn.onclick = () => {
    const menuId = Number(btn.dataset.id);
    if (btn.dataset.menuAction === 'add') addItem(menuId);
    if (btn.dataset.menuAction === 'plus') changeQty(menuId, 1, true);
    if (btn.dataset.menuAction === 'minus') changeQty(menuId, -1, true);
  });
}

function addItem(menuId) {
  const existing = state.cart.find(item => item.menuId === menuId);
  if (existing) existing.qty++;
  else state.cart.push({ menuId, qty: 1, note: '' });
  renderCart();
  renderMenu();
  pulseCartHandle();
}

function changeQty(menuId, delta, pulseHandle = false) {
  const item = state.cart.find(cartItem => cartItem.menuId === menuId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter(cartItem => cartItem.menuId !== menuId);
  renderCart();
  renderMenu();
  if (pulseHandle) pulseCartHandle();
}

function renderCart() {
  if (!state.cart.length) {
    el('cartList').innerHTML = `<div class="empty">Belum ada leker yang dipilih.</div>`;
  } else {
    el('cartList').innerHTML = state.cart.map(item => {
      const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
      return `<div class="cart-item">
        <div class="cart-item-head"><h4>${menu.name}</h4><b>${rupiah(menu.price * item.qty)}</b></div>
        <div class="qty-row"><button class="qty-btn" data-cart-action="minus" data-id="${menu.id}">−</button><b>${item.qty}</b><button class="qty-btn" data-cart-action="plus" data-id="${menu.id}">+</button></div>
        <input class="note-input" data-note-id="${menu.id}" value="${escapeHtml(item.note)}" placeholder="Catatan item, contoh: tipis & crispy" maxlength="120" />
      </div>`;
    }).join('');
  }

  document.querySelectorAll('[data-cart-action]').forEach(btn => btn.onclick = () => {
    changeQty(Number(btn.dataset.id), btn.dataset.cartAction === 'plus' ? 1 : -1);
  });
  document.querySelectorAll('[data-note-id]').forEach(inp => inp.oninput = () => {
    const item = state.cart.find(cartItem => cartItem.menuId === Number(inp.dataset.noteId));
    if (item) item.note = inp.value;
  });

  const itemCount = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const total = state.cart.reduce((sum, item) => {
    const menu = state.menu.find(menuItem => menuItem.id === item.menuId);
    return sum + menu.price * item.qty;
  }, 0);

  el('cartTotal').textContent = rupiah(total);
  el('checkoutBtn').disabled = state.cart.length === 0;
  el('cartHandleCount').textContent = itemCount;
  el('cartHandle').classList.toggle('has-items', itemCount > 0);
  el('cartHandle').setAttribute('aria-label', itemCount ? `Buka pesanan, ${itemCount} item` : 'Buka pesanan, keranjang kosong');
}

function bindInputs() {
  el('checkoutBtn').onclick = submitOrder;
  el('readyButton').onclick = () => alert('Pesanan siap. Silakan menuju kasir dan sebutkan nomor pesanan.');
  el('newOrderBtn').onclick = resetKiosk;
}

function bindCartDrawer() {
  el('cartHandle').onclick = openCart;
  el('cartCloseBtn').onclick = closeCart;
  el('cartBackdrop').onclick = closeCart;

  let edgeTouchStartX = null;
  document.addEventListener('touchstart', event => {
    if (state.cartOpen || event.touches.length !== 1) return;
    const x = event.touches[0].clientX;
    edgeTouchStartX = x >= window.innerWidth - CART_EDGE_GESTURE_PX ? x : null;
  }, { passive: true });

  document.addEventListener('touchend', event => {
    if (edgeTouchStartX === null || !event.changedTouches.length) return;
    const endX = event.changedTouches[0].clientX;
    if (edgeTouchStartX - endX >= CART_SWIPE_THRESHOLD_PX) openCart();
    edgeTouchStartX = null;
  }, { passive: true });

  let drawerTouchStartX = null;
  el('cartDrawer').addEventListener('touchstart', event => {
    drawerTouchStartX = event.touches.length === 1 ? event.touches[0].clientX : null;
  }, { passive: true });

  el('cartDrawer').addEventListener('touchend', event => {
    if (drawerTouchStartX === null || !event.changedTouches.length) return;
    const endX = event.changedTouches[0].clientX;
    if (endX - drawerTouchStartX >= CART_SWIPE_THRESHOLD_PX) closeCart();
    drawerTouchStartX = null;
  }, { passive: true });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.cartOpen) closeCart();
  });
}

function openCart() {
  if (state.activeOrder) return;
  state.cartOpen = true;
  el('cartDrawer').classList.add('open');
  el('cartBackdrop').classList.add('open');
  el('cartHandle').classList.add('drawer-open');
  el('cartDrawer').setAttribute('aria-hidden', 'false');
  el('cartBackdrop').setAttribute('aria-hidden', 'false');
  el('cartHandle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('cart-open');
  setTimeout(() => el('cartCloseBtn').focus(), 180);
}

function closeCart() {
  state.cartOpen = false;
  el('cartDrawer').classList.remove('open');
  el('cartBackdrop').classList.remove('open');
  el('cartHandle').classList.remove('drawer-open');
  el('cartDrawer').setAttribute('aria-hidden', 'true');
  el('cartBackdrop').setAttribute('aria-hidden', 'true');
  el('cartHandle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('cart-open');
}

function pulseCartHandle() {
  const handle = el('cartHandle');
  handle.classList.remove('bump');
  requestAnimationFrame(() => handle.classList.add('bump'));
  setTimeout(() => handle.classList.remove('bump'), 420);
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
    el('checkoutBtn').textContent = 'FIX PESANAN · KIRIM KE KASIR';
  }
}

function showStatus(order) {
  closeCart();
  el('cartHandle').classList.add('hidden');
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
  el('cartHandle').classList.remove('hidden');
  renderCart();
  renderMenu();
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
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}

init().catch(err => {
  console.error('Prototype Leker customer init failed', err);
  el('menuGrid').innerHTML = `<div class="empty">${escapeHtml(err.message || 'UI gagal dimuat.')}</div>`;
});
