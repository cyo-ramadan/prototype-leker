// Mode Warung (skin D) -- DESAIN-SKIN-D-WARUNG.md.
// Satu layar untuk jualan: cari / "paling sering" -> keranjang -> Bayar ->
// uang diterima -> kembalian. Semua data lewat jalur kasir yang sudah ada:
//   GET  /api/cashier/me        (siapa yang jaga, sudah absen atau belum)
//   GET  /api/cashier/drawer    (laci aktif & boleh menulis)
//   GET  /api/cashier/menu      (daftar barang gerai)
//   GET  /api/cashier/workspace (cara bayar yang aktif di gerai)
//   POST /api/cashier/sales     (penjualan -- stok, modal, laci, izin tetap dijaga server)
// Absen dan buka laci TIDAK dibuat ulang di sini: tombol "Mulai jaga warung"
// membawa ke Kasir lengkap, yang punya alur foto + lokasi + laci.
(() => {
  const $ = id => document.getElementById(id);
  const storeCode = () => String(window.LEKER_STORE_CODE || '').toUpperCase();
  const cashierPath = (extra = '') => `${window.lekerStorePath ? window.lekerStorePath('cashier') : '/cashier'}${extra}`;
  const FREQ_KEY = () => `maxiWarungFreq:${storeCode()}`;
  const MAX_QTY = 50;

  const state = {
    products: [],
    cart: new Map(), // productId -> qty
    methods: [],
    method: 'CASH',
    cash: null,
    canWrite: false,
    busy: false
  };

  const rupiah = value => `Rp${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const lineTotal = (product, qty) => Math.round(Number(product.price) * qty);
  const productById = id => state.products.find(product => Number(product.id) === Number(id));

  function toast(message) {
    const node = $('wToast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace(cashierPath());
      throw new Error('Sesi habis, silakan masuk lagi.');
    }
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat data. Coba lagi.');
    return payload;
  }

  // ---- "Paling sering": dihitung dari penjualan di HP ini saja -------------
  function readFreq() {
    try { return JSON.parse(localStorage.getItem(FREQ_KEY()) || '{}') || {}; } catch { return {}; }
  }
  function bumpFreq(lines) {
    const freq = readFreq();
    for (const [id, qty] of lines) freq[id] = (freq[id] || 0) + qty;
    try { localStorage.setItem(FREQ_KEY(), JSON.stringify(freq)); } catch {}
  }

  // ---- Barang ---------------------------------------------------------------
  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function visibleProducts() {
    const query = normalize($('wSearch').value);
    if (query) {
      const words = query.split(' ');
      return state.products
        .filter(product => { const name = normalize(`${product.name} ${product.category || ''}`); return words.every(word => name.includes(word)); })
        .slice(0, 60);
    }
    const freq = readFreq();
    const sorted = [...state.products].sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0) || String(a.name).localeCompare(String(b.name), 'id'));
    return sorted.slice(0, 24);
  }

  function renderTiles() {
    const query = $('wSearch').value.trim();
    $('wSearchClear').hidden = !query;
    const freq = readFreq();
    const hasHistory = Object.keys(freq).length > 0;
    $('wListTitle').textContent = query ? 'Hasil cari' : (hasHistory ? 'Paling sering' : 'Barang');
    const list = visibleProducts();
    $('wTiles').innerHTML = list.map(product => {
      const qty = state.cart.get(Number(product.id)) || 0;
      return `<button type="button" class="w-tile ${qty ? 'in-cart' : ''}" data-add="${esc(product.id)}" aria-label="Tambah ${esc(product.name)}">
        <b>${esc(product.name)}</b><span>${rupiah(product.price)}</span>${qty ? `<i>${qty}</i>` : ''}</button>`;
    }).join('');
    const empty = $('wEmpty');
    empty.hidden = list.length > 0;
    empty.textContent = query
      ? `"${query}" tidak ketemu. Coba kata lain, atau tambahkan barangnya lewat Kasir lengkap.`
      : 'Belum ada barang di gerai ini. Tambahkan barang lewat Workspace Gerai.';
  }

  // ---- Keranjang -------------------------------------------------------------
  function cartTotals() {
    let count = 0;
    let total = 0;
    for (const [id, qty] of state.cart) {
      const product = productById(id);
      if (!product) continue;
      count += qty;
      total += lineTotal(product, qty);
    }
    return { count, total };
  }

  function setQty(id, qty) {
    const key = Number(id);
    if (qty <= 0) state.cart.delete(key);
    else state.cart.set(key, Math.min(MAX_QTY, qty));
    renderCart();
    renderTiles();
  }

  function renderCart() {
    const { count, total } = cartTotals();
    $('wCartBar').hidden = count === 0 || !state.canWrite;
    $('wCartCount').textContent = count;
    $('wCartTotal').textContent = rupiah(total);
    $('wCartLines').innerHTML = [...state.cart].map(([id, qty]) => {
      const product = productById(id);
      if (!product) return '';
      return `<div class="w-line"><div><b>${esc(product.name)}</b><small>${qty} × ${rupiah(product.price)} = ${rupiah(lineTotal(product, qty))}</small></div>
        <div class="w-step"><button type="button" data-dec="${esc(id)}" aria-label="Kurangi">−</button><span>${qty}</span><button type="button" data-inc="${esc(id)}" aria-label="Tambah">+</button></div></div>`;
    }).join('');
    if (count === 0) closeSheet('wCartSheet');
  }

  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }

  // ---- Bayar -----------------------------------------------------------------
  function isCash() { return state.method === 'CASH' || !state.methods.length; }

  function quickAmounts(total) {
    const picks = [total];
    for (const step of [5000, 10000, 20000, 50000, 100000]) {
      const value = Math.ceil(total / step) * step;
      if (value > total && !picks.includes(value)) picks.push(value);
    }
    for (const note of [20000, 50000, 100000]) if (note > total && !picks.includes(note)) picks.push(note);
    return picks.sort((a, b) => a - b).slice(0, 4);
  }

  function renderPay() {
    const { total } = cartTotals();
    $('wDue').textContent = rupiah(total);
    $('wMethods').innerHTML = state.methods.length > 1
      ? state.methods.map(method => `<button type="button" class="w-method" data-method="${esc(method.code)}" aria-pressed="${method.code === state.method}">${esc(method.name)}</button>`).join('')
      : '';
    $('wCashBox').hidden = !isCash();
    if (isCash()) {
      $('wQuick').innerHTML = quickAmounts(total).map((value, index) =>
        `<button type="button" data-cash="${value}" aria-pressed="${state.cash === value}">${index === 0 ? 'Uang pas' : rupiah(value)}</button>`).join('');
      const change = state.cash === null ? null : state.cash - total;
      const box = $('wChange').parentElement;
      box.classList.toggle('short', change !== null && change < 0);
      box.querySelector('small').textContent = change !== null && change < 0 ? 'Uang kurang' : 'Kembalian';
      $('wChange').textContent = change === null ? '—' : rupiah(Math.abs(change));
      $('wFinish').disabled = state.busy || change === null || change < 0;
    } else {
      $('wFinish').disabled = state.busy;
    }
    $('wFinish').textContent = state.busy ? 'Menyimpan…' : 'Selesai';
  }

  function openPay() {
    if (!state.cart.size) return;
    state.cash = null;
    $('wCash').value = '';
    closeSheet('wCartSheet');
    openSheet('wPaySheet');
    renderPay();
  }

  async function finish() {
    if (state.busy) return;
    const { total } = cartTotals();
    const change = isCash() && state.cash !== null ? state.cash - total : 0;
    state.busy = true;
    renderPay();
    const lines = [...state.cart];
    try {
      const body = { items: lines.map(([productId, quantity]) => ({ productId, quantity })), customerName: 'Pembeli' };
      if (state.methods.length) body.paymentMethod = state.method;
      const payload = await api('/api/cashier/sales', { method: 'POST', body: JSON.stringify(body) });
      bumpFreq(lines);
      state.cart.clear();
      closeSheet('wPaySheet');
      $('wDoneText').textContent = isCash() ? `Kembalian ${rupiah(change)}` : `${rupiah(payload.sale?.total ?? total)} diterima`;
      $('wDone').hidden = false;
      try { navigator.vibrate?.(60); } catch {}
      $('wDoneNext').focus();
    } catch (error) {
      toast(error.message);
    } finally {
      state.busy = false;
      renderPay();
      renderCart();
      renderTiles();
    }
  }

  function nextSale() {
    $('wDone').hidden = true;
    $('wSearch').value = '';
    renderTiles();
    $('wSearch').focus();
  }

  // ---- Siap jaga? --------------------------------------------------------------
  function showGate(title, text, button, href) {
    $('wGate').hidden = false;
    $('wSell').hidden = true;
    $('wGateTitle').textContent = title;
    $('wGateText').textContent = text;
    $('wGateBtn').textContent = button;
    $('wGateBtn').href = href;
  }

  async function load() {
    if (!localStorage.getItem('lekerCashierToken')) {
      location.replace(cashierPath());
      return;
    }
    $('wFullCashier').href = cashierPath('?lengkap=1');
    try {
      const [me, drawer] = await Promise.all([api('/api/cashier/me'), api('/api/cashier/drawer')]);
      const cashier = me.cashier || drawer.cashier || {};
      $('wStoreName').textContent = cashier.store?.storeName || window.MaxiSkin?.brand() || 'Warung';
      $('wWho').textContent = `Dijaga ${cashier.employeeName || cashier.username || 'kasir'}`;
      state.canWrite = Boolean(drawer.canWrite);
      if (me.attendanceStatus !== 'in') {
        showGate('Belum absen', 'Absen dulu dengan foto, lalu buka laci. Setelah itu kembali ke sini untuk jualan.', 'Absen & buka warung', cashierPath('?lengkap=1'));
        return;
      }
      if (!drawer.drawer) {
        showGate('Laci belum dibuka', 'Buka laci dulu supaya uang yang masuk tercatat. Setelah itu kembali ke sini.', 'Buka laci', cashierPath('?lengkap=1'));
        return;
      }
      if (!drawer.canWrite) {
        const holder = drawer.drawer.cashierName || drawer.drawer.cashierUsername || 'kasir lain';
        showGate('Laci dipegang orang lain', `Laci yang terbuka sekarang milik ${holder}. Minta ditutup dulu, atau ajukan izin tutup laci lewat Kasir lengkap.`, 'Buka Kasir lengkap', cashierPath('?lengkap=1'));
        return;
      }
      const [menu, workspace] = await Promise.all([api('/api/cashier/menu'), api('/api/cashier/workspace').catch(() => ({}))]);
      state.products = (menu.products || []).filter(product => Number(product.price) >= 0);
      // Cara bayar untuk PEMBELI warung saja: "Hutang/Utang Usaha" (utang ke
      // supplier) dan "Non Tunai (legacy)" tidak masuk akal di layar jualan.
      state.methods = (Array.isArray(workspace.paymentMethods) ? workspace.paymentMethods : [])
        .filter(method => !['PAYABLE', 'NON_CASH'].includes(String(method.code).toUpperCase()))
        .map(method => (method.code === 'CASH' ? { ...method, name: 'Tunai' } : method));
      state.method = state.methods.find(item => item.isDefault)?.code || state.methods.find(item => item.code === 'CASH')?.code || state.methods[0]?.code || 'CASH';
      $('wGate').hidden = true;
      $('wSell').hidden = false;
      renderTiles();
      renderCart();
    } catch (error) {
      showGate('Belum bisa dibuka', error.message, 'Coba lagi', location.href);
    }
  }

  // ---- Event -------------------------------------------------------------------
  $('wSearch').addEventListener('input', renderTiles);
  $('wSearch').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = visibleProducts()[0];
    if (first) { setQty(first.id, (state.cart.get(Number(first.id)) || 0) + 1); $('wSearch').select(); }
  });
  $('wSearchClear').addEventListener('click', () => { $('wSearch').value = ''; renderTiles(); $('wSearch').focus(); });
  $('wTiles').addEventListener('click', event => {
    const tile = event.target.closest('[data-add]');
    if (!tile) return;
    const id = Number(tile.dataset.add);
    const next = (state.cart.get(id) || 0) + 1;
    if (next > MAX_QTY) return toast(`Maksimal ${MAX_QTY} per barang dalam satu transaksi.`);
    setQty(id, next);
  });
  $('wCartToggle').addEventListener('click', () => openSheet('wCartSheet'));
  $('wCartClose').addEventListener('click', () => closeSheet('wCartSheet'));
  $('wCartSheet').addEventListener('click', event => { if (event.target.id === 'wCartSheet') closeSheet('wCartSheet'); });
  $('wCartLines').addEventListener('click', event => {
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    if (inc) setQty(inc.dataset.inc, (state.cart.get(Number(inc.dataset.inc)) || 0) + 1);
    if (dec) setQty(dec.dataset.dec, (state.cart.get(Number(dec.dataset.dec)) || 0) - 1);
  });
  $('wCartClear').addEventListener('click', () => { state.cart.clear(); renderCart(); renderTiles(); });
  $('wPayBtn').addEventListener('click', openPay);
  $('wPayClose').addEventListener('click', () => closeSheet('wPaySheet'));
  $('wMethods').addEventListener('click', event => {
    const button = event.target.closest('[data-method]');
    if (!button) return;
    state.method = button.dataset.method;
    renderPay();
  });
  $('wQuick').addEventListener('click', event => {
    const button = event.target.closest('[data-cash]');
    if (!button) return;
    state.cash = Number(button.dataset.cash);
    $('wCash').value = '';
    renderPay();
  });
  $('wCash').addEventListener('input', () => {
    const digits = $('wCash').value.replace(/\D/g, '');
    state.cash = digits ? Number(digits) : null;
    $('wCash').value = digits ? Number(digits).toLocaleString('id-ID') : '';
    renderPay();
  });
  $('wFinish').addEventListener('click', finish);
  $('wDoneNext').addEventListener('click', nextSale);
  $('wMoreBtn').addEventListener('click', () => {
    const menu = $('wMoreMenu');
    menu.hidden = !menu.hidden;
    $('wMoreBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#wMoreMenu, #wMoreBtn')) { $('wMoreMenu').hidden = true; $('wMoreBtn').setAttribute('aria-expanded', 'false'); }
  });
  $('wRefresh').addEventListener('click', () => { $('wMoreMenu').hidden = true; load(); });
  $('wLogout').addEventListener('click', async () => {
    try { await api('/api/cashier/logout', { method: 'POST' }); } catch {}
    try { localStorage.removeItem('lekerCashierToken'); localStorage.removeItem('lekerStaffSessionMeta'); } catch {}
    location.replace(cashierPath());
  });
  // Refresh saat kembali ke tab (bukan polling -- invariant #6).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('wSell').hidden) load(); });

  load();
})();
