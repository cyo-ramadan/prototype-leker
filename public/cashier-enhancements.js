(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 4 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';

  function insertSalePayment() {
    if (el('salePaymentMethod')) return;
    const note = el('saleNote')?.closest('.field');
    if (!note) return;
    note.insertAdjacentHTML('afterend', '<div class="field"><label>Metode pembayaran</label><select id="salePaymentMethod" class="text-input"><option value="CASH">Tunai</option><option value="NON_CASH">Non Tunai</option></select></div>');
  }

  // Bos Cyo, 2026-09-21: dilaporkan dari Pendem dan Beji -- Beli Bahan gagal
  // total ("wajib memiliki 1-50 baris barang") walau barangnya sudah
  // kelihatan di Detail. Akarnya BUKAN di dialog PIMASATU (public/cashier-
  // payment-methods.js, sudah dipakai untuk Beli Bahan/Operasional/
  // Penjualan sejak migrasi PIMASATU) -- akarnya di file INI. enhanceDialog()
  // dan window.fetch wrapper di bawah masih peninggalan editor Beli Bahan
  // yang LAMA (dicek dari title="Beli Bahan" persis, sebelum jadi "Beli
  // Bahan · Transaksi"), jadi dua-duanya sudah mati -- title-nya tidak
  // pernah cocok lagi, [data-purchase-row] tidak pernah dibuat. TAPI
  // window.fetch wrapper tetap jalan tanpa syarat itu, dan sebelum
  // perbaikan Safari 2026-09-19 (canonicalFactPost pindah dari `new
  // Request(...)` ke `fetch(path, init)` string biasa) wrapper ini
  // kebetulan tidak pernah aktif untuk path Beli Bahan (dicegat lewat
  // `if (!supported || request) return originalFetch(...)` karena input-nya
  // masih instance Request). Begitu jadi string, wrapper ini justru IKUT
  // jalan dan menimpa body.items dengan hasil query DOM [data-purchase-row]
  // milik editor lama -- selalu kosong sekarang -- jadi payload yang
  // sudah benar dari PIMASATU ketiban array kosong SEBELUM sempat terkirim.
  // Perbaikannya: seluruh editor Beli Bahan lama (di bawah) dan blok fetch
  // wrapper untuk sales/purchases/expenses dihapus -- cashier-payment-
  // methods.js sudah memegang penuh ketiga path itu sendiri, wrapper di
  // sini tidak lagi dibutuhkan (dan berbahaya kalau dibiarkan menyala
  // lagi tanpa sengaja). shiftLabel/closingNote (Buka Laci/Tutup Laci)
  // masih perlu wrapper ini -- itu satu-satunya jalur yang menyisipkan dua
  // field itu ke body, jadi dipertahankan.

  function enhanceDialog() {
    const title = el('cashierDialogTitle')?.textContent || '';
    const body = el('cashierDialogBody');
    if (!body) return;
    if (title === 'Buka Laci' && !el('dialogShiftLabel')) {
      body.insertAdjacentHTML('afterbegin', '<div class="field"><label>Shift <span class="muted">optional</span></label><input id="dialogShiftLabel" class="text-input" maxlength="60" placeholder="Contoh: S4" /></div>');
    }
    if (title === 'Tutup Laci' && !el('dialogClosingNote')) {
      body.insertAdjacentHTML('beforeend', '<div class="field"><label>Keterangan pulang <span class="muted">optional</span></label><textarea id="dialogClosingNote" rows="3" maxlength="500" placeholder="Catatan akhir shift"></textarea></div>');
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function cashierEnhancedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.origin);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const supported = url.origin === location.origin && method === 'POST' && [
      '/api/cashier/drawer/open',
      '/api/cashier/drawer/close'
    ].includes(url.pathname);
    if (!supported || request) return originalFetch(input, init);

    let body;
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return originalFetch(input, init); }
    if (url.pathname === '/api/cashier/drawer/open') body.shiftLabel = el('dialogShiftLabel')?.value || '';
    if (url.pathname === '/api/cashier/drawer/close') body.closingNote = el('dialogClosingNote')?.value || '';
    return originalFetch(input, { ...init, body: JSON.stringify(body) });
  };

  function ensureHistoryUi() {
    insertSalePayment();
    const actions = document.querySelector('.drawer-actions');
    if (actions && !el('drawerHistoryBtn')) {
      const button = document.createElement('button');
      button.id = 'drawerHistoryBtn';
      button.className = 'drawer-action-btn';
      button.type = 'button';
      button.textContent = '📚 Detail Laci';
      button.addEventListener('click', openDrawerHistory);
      actions.appendChild(button);
    }
    if (!el('cashierDrawerHistoryDialog')) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog id="cashierDrawerHistoryDialog" class="cashier-dialog cashier-dialog-plain" style="max-width:min(1080px,96vw);width:96vw">
          <div class="cashier-dialog-head"><div><div class="muted">Gerai kasir</div><h2>Detail Laci</h2></div><button id="cashierDrawerHistoryClose" class="cart-close-btn" type="button">×</button></div>
          <div id="cashierDrawerHistoryList" class="drawer-history-grid"></div>
        </dialog>`);
      el('cashierDrawerHistoryClose').onclick = () => el('cashierDrawerHistoryDialog').close();
    }
    if (!el('cashierDrawerDetailDialog')) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog id="cashierDrawerDetailDialog" class="cashier-dialog cashier-dialog-plain" style="max-width:min(1080px,96vw);width:96vw">
          <div class="cashier-dialog-head"><div><div class="muted">Gerai kasir</div><h2>Rincian Laci</h2></div><button id="cashierDrawerDetailClose" class="cart-close-btn" type="button">×</button></div>
          <div id="cashierDrawerHistoryReport" class="drawer-report-panel"></div>
        </dialog>`);
      el('cashierDrawerDetailClose').onclick = () => el('cashierDrawerDetailDialog').close();
    }
  }

  async function cashierRequest(path) {
    const token = localStorage.getItem('lekerCashierToken') || '';
    const response = await originalFetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  async function openDrawerHistory() {
    ensureHistoryUi();
    const dialog = el('cashierDrawerHistoryDialog');
    const list = el('cashierDrawerHistoryList');
    list.innerHTML = '<div class="muted">Memuat riwayat laci...</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const payload = await cashierRequest('/api/cashier/drawers');
      const drawers = payload.drawers || [];
      // Daftar dari server sudah ORDER BY opened_at DESC (baru dulu) --
      // nomor urut "Laci #N" dihitung dari yang paling lama supaya laci
      // pertama gerai selalu #1, bukan berubah-ubah ikut halaman/limit.
      const total = drawers.length;
      list.innerHTML = drawers.length ? drawers.map((drawer, index) => `
        <article class="drawer-history-row${drawer.status === 'OPEN' ? ' open' : ''}">
          <div><strong>Laci #${total - index} · ${esc(drawer.cashierName)} · ${esc(drawer.status)}</strong><small>ID ${esc(drawer.id)}${drawer.shiftLabel ? ` · Shift ${esc(drawer.shiftLabel)}` : ''}</small><small>Datang ${dateTime(drawer.openedAt)} · Pulang ${dateTime(drawer.closedAt)}</small><small>Modal ${money(drawer.openingAmount)} · @${esc(drawer.cashierUsername)}</small>${drawer.openingNote ? `<small>Keterangan buka: ${esc(drawer.openingNote)}</small>` : ''}${drawer.closingNote ? `<small>Keterangan pulang: ${esc(drawer.closingNote)}</small>` : ''}</div>
          <div class="drawer-history-actions"><button class="mini-btn" type="button" data-cashier-drawer-detail="${esc(drawer.id)}">Lihat Detail</button></div>
        </article>`).join('') : '<div class="empty">Belum ada riwayat laci di gerai ini.</div>';
      document.querySelectorAll('[data-cashier-drawer-detail]').forEach(button => button.onclick = () => loadDrawerDetail(button.dataset.cashierDrawerDetail));
    } catch (error) {
      list.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  async function loadDrawerDetail(id) {
    ensureHistoryUi();
    const dialog = el('cashierDrawerDetailDialog');
    const panel = el('cashierDrawerHistoryReport');
    panel.innerHTML = '<div class="muted">Memuat detail...</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const payload = await cashierRequest(`/api/cashier/drawers/${encodeURIComponent(id)}/details`);
      panel.innerHTML = window.MAXIDrawerReport?.render(payload.report) || '<div class="empty">Renderer detail laci belum tersedia.</div>';
    } catch (error) {
      panel.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  const dialogBody = el('cashierDialogBody');
  if (dialogBody) new MutationObserver(enhanceDialog).observe(dialogBody, { childList: true, subtree: true });
  ensureHistoryUi();
})();
