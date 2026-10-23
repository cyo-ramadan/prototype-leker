(() => {
  // Bos Cyo, 2026-10-23: "setiap cs mau buka laci maka dia wajib stok opname ... ketika dibuka dia
  // langsung masuk ke form penyesuaian stok dimana semua bahan2 sudah masuk di list disana, dia
  // tinggal ngisi qty nya saja. ditambah lagi cek uang laci saat itu juga sama aset" -- server:
  // src/tugas-buka-laci.js. Begitu laci milik kasir ini berstatus PENDING, wizard tiga langkah
  // langsung terbuka (sekali per laci per muat halaman); selama belum selesai ada banner untuk
  // membukanya lagi, dan server menolak transaksi laci (423 OPENING_CHECK_REQUIRED).
  // Qty/uang tercatat sengaja tidak ditampilkan sebelum CS menghitung (hitung buta); selisihnya
  // baru diperlihatkan di langkah periksa sebelum disimpan.
  const autoOpened = new Set();
  const formatQty = value => Number(value).toLocaleString('id-ID');
  const rupiah = value => `Rp${Math.abs(Number(value) || 0).toLocaleString('id-ID')}`;
  const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatQty(Math.abs(value))}`;
  let current = null;

  const STYLE = `<style>
    .tbl-steps{display:flex;gap:6px;margin-bottom:10px}
    .tbl-steps span{flex:1;text-align:center;font-size:11px;font-weight:800;padding:6px 4px;border-radius:999px;background:#f1f3f5;color:#6b7280}
    .tbl-steps span.done{background:#e6f6ea;color:#2f9e44}
    .tbl-steps span.now{background:#111827;color:#fff}
    .tbl-list{border:1px solid #e1e5eb;border-radius:12px;overflow:hidden}
    .tbl-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid #edf0f4;background:#fff}
    .tbl-row:first-child{border-top:0}
    .tbl-row strong{display:block;overflow-wrap:anywhere}
    .tbl-row small{display:block;color:#6b7280;font-size:10px}
    .tbl-row input{width:100%;margin:0;text-align:right;font-weight:800}
    .tbl-row.diff{background:#fff7e6}
    .tbl-row .tbl-diff{text-align:right;font-weight:800}
    .tbl-asset{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px;border-top:1px solid #edf0f4}
    .tbl-asset:first-child{border-top:0}
    .tbl-asset strong{flex:1 1 100%}
    .tbl-asset label{display:flex;gap:6px;align-items:center;font-weight:700}
    .tbl-asset input[type=text]{flex:1 1 100%;margin:0}
    .tbl-note{background:#f6f7f9;border-radius:10px;padding:9px 10px;font-size:11px;color:#4b5563;line-height:1.45;margin-top:10px}
    .tbl-banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:8px;padding:10px 12px;border-radius:12px;background:#fff4e5;border:1px solid #f5c26b;color:#7a4b00;font-weight:700}
  </style>`;

  function steps(check) {
    // Langkah yang dimatikan Admin Gerai (Pengaturan -> Tugas Harian & Buka Laci) tidak ditampilkan.
    const skipped = new Set(check.skipped || []);
    const items = [['stock', 'Stok opname', check.stock.doneAt], ['cash', 'Uang laci', check.cash.doneAt], ['assets', 'Aset', check.assets.doneAt]]
      .filter(([part]) => !skipped.has(part)).map(([, label, done]) => [label, done]);
    const nowIndex = items.findIndex(([, done]) => !done);
    return `<div class="tbl-steps">${items.map(([label, done], index) => `<span class="${done ? 'done' : index === nowIndex ? 'now' : ''}">${done ? '✓ ' : `${index + 1}. `}${escapeHtml(label)}</span>`).join('')}</div>`;
  }

  async function load() {
    current = await api('/api/cashier/drawer/opening-check');
    return current;
  }

  function nextStep() {
    if (!current?.required || current.status !== 'PENDING' || !current.canWork) return null;
    if (!current.check.stock.doneAt) return 'stock';
    if (!current.check.cash.doneAt) return 'cash';
    if (!current.check.assets.doneAt) return 'assets';
    return null;
  }

  async function afterStep(message) {
    toast(message);
    await load();
    if (nextStep()) setTimeout(openStep, 0);
    else {
      toast('Tugas Buka Laci selesai. Laci siap dipakai.');
      await (window.refreshCashierWorkspace ? window.refreshCashierWorkspace({ includeMenu: false }) : loadDrawer());
    }
  }

  function openStock() {
    const items = current.stockItems || [];
    let reviewing = false;
    openDialog({
      eyebrow: 'Tugas Buka Laci',
      title: 'Stok Opname',
      body: `${STYLE}${steps(current.check)}
        <p class="muted">Hitung fisik setiap bahan lalu isi qty nyatanya. Semua bahan wajib diisi (isi 0 kalau habis).</p>
        <div id="tblStockList" class="tbl-list">${items.length ? items.map(item => `
          <div class="tbl-row" data-tbl-row="${Number(item.productId)}">
            <div><strong>${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.unitSymbol || '')}</small></div>
            <input class="text-input" type="number" min="0" step="1" inputmode="numeric" data-tbl-qty="${Number(item.productId)}" aria-label="Qty nyata ${escapeHtml(item.productName)}" />
          </div>`).join('') : '<div class="tbl-row"><div><strong>Belum ada bahan untuk dihitung.</strong><small>Langkah ini langsung selesai.</small></div></div>'}</div>
        <div id="tblStockReview"></div>
        <div class="field" style="margin-top:10px"><label>Catatan <span class="muted">optional</span></label><textarea id="tblStockNote" rows="2" maxlength="400" placeholder="Contoh: gula tumpah sedikit"></textarea></div>`,
      submitText: 'PERIKSA HASIL HITUNG',
      onSubmit: async () => {
        const counted = items.map(item => {
          const raw = el('cashierDialogBody').querySelector(`[data-tbl-qty="${Number(item.productId)}"]`)?.value ?? '';
          return { item, raw: String(raw).trim(), quantity: Number(raw) };
        });
        const empty = counted.filter(row => row.raw === '' || !Number.isInteger(row.quantity) || row.quantity < 0);
        if (empty.length) {
          el('cashierDialogBody').querySelector(`[data-tbl-qty="${Number(empty[0].item.productId)}"]`)?.focus();
          throw new Error(`Qty nyata belum diisi: ${empty.slice(0, 3).map(row => row.item.productName).join(', ')}${empty.length > 3 ? ` dan ${empty.length - 3} lainnya` : ''}.`);
        }
        const diffs = counted.filter(row => row.quantity !== row.item.currentQuantity);
        if (!reviewing) {
          reviewing = true;
          el('tblStockReview').innerHTML = `<div class="tbl-note"><b>${diffs.length ? `${diffs.length} bahan berselisih` : 'Semua bahan cocok dengan catatan'}</b>${diffs.length ? ' -- cek lagi yang berselisih. Kalau sudah benar, tekan Simpan; selisihnya langsung jadi Penyesuaian Stok.' : '.'}</div>
            ${diffs.length ? `<div class="tbl-list" style="margin-top:8px">${diffs.map(row => `
              <div class="tbl-row diff"><div><strong>${escapeHtml(row.item.productName)}</strong><small>Tercatat ${formatQty(row.item.currentQuantity)} · Nyata ${formatQty(row.quantity)} ${escapeHtml(row.item.unitSymbol || '')}</small></div>
              <div class="tbl-diff">${signed(row.quantity - row.item.currentQuantity)}</div></div>`).join('')}</div>` : ''}`;
          el('cashierDialogSubmit').textContent = 'SIMPAN STOK OPNAME';
          el('tblStockReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
          el('cashierDialogBody').addEventListener('input', () => {
            reviewing = false;
            el('tblStockReview').innerHTML = '';
            el('cashierDialogSubmit').textContent = 'PERIKSA HASIL HITUNG';
          }, { once: true });
          return false;
        }
        const result = await api('/api/cashier/drawer/opening-check/stock', {
          method: 'POST',
          body: JSON.stringify({ items: counted.map(row => ({ productId: row.item.productId, quantity: row.quantity })), note: el('tblStockNote').value })
        });
        setTimeout(() => afterStep(`Stok opname tersimpan · ${result.diffCount ? `${result.diffCount} Penyesuaian Stok diposting` : 'tanpa selisih'}.`), 0);
        return true;
      }
    });
    requestAnimationFrame(() => el('cashierDialogBody').querySelector('[data-tbl-qty]')?.focus());
  }

  function openCash() {
    openDialog({
      eyebrow: 'Tugas Buka Laci',
      title: 'Hitung Uang Laci',
      body: `${STYLE}${steps(current.check)}
        <div class="field"><label>Uang di laci sekarang (hitung fisik semua uang di laci)</label><input id="tblCashCounted" class="text-input" type="number" min="0" step="1" inputmode="numeric" required /></div>
        <div class="tbl-note">Saldo awal laci tetap mengikuti sistem. Kalau hasil hitung berbeda, selisihnya dicatat di laporan laci dan admin dikabari.</div>`,
      submitText: 'SIMPAN UANG LACI',
      onSubmit: async () => {
        const raw = el('tblCashCounted').value.trim();
        if (raw === '') throw new Error('Isi jumlah uang di laci.');
        const result = await api('/api/cashier/drawer/opening-check/cash', { method: 'POST', body: JSON.stringify({ countedAmount: Number(raw) }) });
        const message = result.difference
          ? `Uang laci ${result.difference > 0 ? 'lebih' : 'kurang'} ${rupiah(result.difference)} dari sistem (${rupiah(result.systemAmount)}). Admin dikabari.`
          : 'Uang laci cocok dengan sistem.';
        setTimeout(() => afterStep(message), 0);
        return true;
      }
    });
    requestAnimationFrame(() => el('tblCashCounted')?.focus());
  }

  function openAssets() {
    const assets = current.assets || [];
    openDialog({
      eyebrow: 'Tugas Buka Laci',
      title: 'Cek Aset',
      body: `${STYLE}${steps(current.check)}
        <div class="tbl-list">${assets.map(asset => `
          <div class="tbl-asset" data-tbl-asset="${escapeHtml(asset.id)}">
            <strong>${escapeHtml(asset.name)}${asset.description ? `<small class="muted" style="display:block;font-weight:400">${escapeHtml(asset.description)}</small>` : ''}</strong>
            <label><input type="radio" name="tbl_${escapeHtml(asset.id)}" value="1" /> Ada</label>
            <label><input type="radio" name="tbl_${escapeHtml(asset.id)}" value="0" /> Tidak ada</label>
            <input class="text-input" type="text" maxlength="200" placeholder="Catatan (optional)" data-tbl-asset-note />
          </div>`).join('')}</div>`,
      submitText: 'SIMPAN CEK ASET',
      onSubmit: async () => {
        const items = assets.map(asset => {
          const node = el('cashierDialogBody').querySelector(`[data-tbl-asset="${CSS.escape(asset.id)}"]`);
          const picked = node?.querySelector('input[type=radio]:checked');
          return { id: asset.id, name: asset.name, present: picked ? picked.value === '1' : null, note: node?.querySelector('[data-tbl-asset-note]')?.value || '' };
        });
        const unanswered = items.filter(item => item.present === null);
        if (unanswered.length) throw new Error(`Pilih Ada / Tidak ada untuk: ${unanswered.map(item => item.name).join(', ')}.`);
        const result = await api('/api/cashier/drawer/opening-check/assets', { method: 'POST', body: JSON.stringify({ items }) });
        setTimeout(() => afterStep(result.missing?.length ? `Aset tidak ada: ${result.missing.join(', ')}. Admin dikabari.` : 'Aset lengkap.'), 0);
        return true;
      }
    });
  }

  async function openStep() {
    try {
      await load();
      const step = nextStep();
      if (step === 'stock') openStock();
      else if (step === 'cash') openCash();
      else if (step === 'assets') openAssets();
    } catch (error) { toast(error.message); }
  }

  function renderBanner() {
    const pending = !state.readOnly && state.drawer?.openingCheckStatus === 'PENDING' && state.drawer.cashierId === state.cashier?.id;
    let banner = el('tugasBukaLaciBanner');
    if (!pending) { banner?.remove(); return false; }
    if (!banner) {
      el('drawerStatusText')?.insertAdjacentHTML('afterend', '<div id="tugasBukaLaciBanner" class="tbl-banner"><span>📋 Tugas Buka Laci belum selesai -- transaksi ditahan.</span><button type="button" class="primary-btn" data-tugas-buka-laci>Kerjakan</button></div>');
      banner = el('tugasBukaLaciBanner');
    }
    return true;
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-tugas-buka-laci]')) return;
    event.preventDefault();
    openStep();
  });

  document.addEventListener('cashier:workspace-applied', () => {
    if (!renderBanner()) return;
    const drawerId = state.drawer.id;
    if (autoOpened.has(drawerId)) return;
    autoOpened.add(drawerId);
    // Dialog Buka Laci masih menutup saat workspace dimuat ulang -- tunggu sebentar.
    const tryOpen = (attempt = 0) => {
      if (el('cashierDialog')?.open && attempt < 20) return setTimeout(() => tryOpen(attempt + 1), 150);
      if (!el('cashierDialog')?.open) openStep();
    };
    setTimeout(tryOpen, 0);
  });

})();
