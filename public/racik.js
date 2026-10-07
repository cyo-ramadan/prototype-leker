// Layar Racik (skin F, Racik Parfum) -- DESAIN-SKIN-F-RACIK-PARFUM.md.
// Toko parfum racikan: setiap botol takarannya bisa beda per pelanggan
// ("Bubble Gum Kiki" tidak sama dengan "Bubble Gum" pelanggan lain).
// Alur: Pesanan (pelanggan + aroma) -> Racik (takaran bahan) -> Bayar -> Nota.
//
// TIDAK ada model transaksi baru. Semua lewat jalur kasir yang sudah ada:
//   GET  /api/cashier/me, /api/cashier/drawer  (sudah absen? laci dipegang?)
//   GET  /api/cashier/production/options       (aroma = barang ber-resep ACTIVE, bahan + sisa stok)
//   GET  /api/cashier/menu                     (harga daftar aroma)
//   GET  /api/cashier/workspace                (cara bayar aktif)
//   POST /api/cashier/production               (1 botol diracik; resep hanya template,
//                                               takaran aktual = hasil edit; HPP ikut takaran aktual)
//   POST /api/cashier/sales                    (botol itu dijual; productionMode STOCK supaya
//                                               bahan tidak terpotong dua kali; unitPrice boleh
//                                               diubah -- server hanya menerima untuk tenant skin F
//                                               dan mencatat "Harga daftar … → dijual …")
//
// Draft & "racikan terakhir per pelanggan" disimpan di HP/tablet ini saja
// (localStorage, keputusan Bos Cyo 2026-10-06). Draft punya tahap; tahap
// "diracik" berarti produksi SUDAH tercatat tapi pembayaran belum -- lanjutkan
// hanya mengulang penjualan, takaran tidak bisa diubah lagi.
(() => {
  const $ = id => document.getElementById(id);
  const storeCode = () => String(window.LEKER_STORE_CODE || '').toUpperCase();
  const cashierPath = (extra = '') => `${window.lekerStorePath ? window.lekerStorePath('cashier') : '/cashier'}${extra}`;
  const DRAFTS_KEY = () => `maxiRacikDrafts:${storeCode()}`;
  const LAST_KEY = () => `maxiRacikLast:${storeCode()}`;
  const NOTA_KEY = () => `maxiRacikNota:${storeCode()}`;
  // Pemilik/Admin yang masuk dari tombol "Jual" di Panel Pemilik (sesi kasir
  // "Pemilik", POST /api/management/racik/kasir-pemilik). Keluar = kembali ke
  // panel, bukan ke halaman login kasir.
  const OWNER_KEY = 'maxiRacikPemilik';
  const ownerMode = () => { try { return localStorage.getItem(OWNER_KEY) === storeCode(); } catch { return false; } };
  const ownerReturn = () => {
    let path = '';
    try { path = localStorage.getItem('maxiRacikPemilikKembali') || ''; } catch {}
    return /^\/[^/]/.test(path) ? path : '/entity-admin';
  };
  const exitPath = () => (ownerMode() ? ownerReturn() : cashierPath());
  const MAX_QTY = 100000;
  const MAX_PRICE = 100000000;
  const STEPS = ['pesanan', 'racik', 'bayar', 'nota'];
  const STAGE_LABEL = {
    pesanan: 'Belum pilih aroma',
    racik: 'Sedang ditakar',
    bayar: 'Siap bayar',
    diracik: 'Sudah diracik · belum dibayar'
  };
  // Warna minyak per bahan (stabil per nama), alkohol selalu bening.
  const OILS = ['#E8A3BE', '#C7A6E4', '#F1C27D', '#9DD3C4', '#F3A984', '#AFC3F2', '#D8BE98', '#E7B7D8'];

  const state = {
    aromas: [],
    materials: new Map(),
    prices: new Map(),
    methods: [],
    method: 'CASH',
    cash: null,
    canWrite: false,
    busy: false,
    draft: null,
    view: 'home',
    pushed: false,
    cashierName: '',
    storeName: ''
  };

  const rupiah = value => `Rp${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const qtyText = value => Number(value || 0).toLocaleString('id-ID');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const normalize = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const digits = value => { const only = String(value ?? '').replace(/\D/g, ''); return only ? Number(only) : null; };
  const isAlcohol = name => /alkohol|alcohol|etanol|ethanol|pelarut|solvent/i.test(String(name || ''));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  function oilOf(name) {
    if (isAlcohol(name)) return '#EEF3F6';
    let hash = 0;
    for (const char of normalize(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return OILS[hash % OILS.length];
  }

  function toast(message) {
    const node = $('rToast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace(exitPath());
      throw new Error('Sesi habis, silakan masuk lagi.');
    }
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat data. Coba lagi.');
    return payload;
  }

  // ---- Penyimpanan di HP/tablet ini ----------------------------------------
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  const readDrafts = () => (Array.isArray(readJson(DRAFTS_KEY(), [])) ? readJson(DRAFTS_KEY(), []) : []);

  function isEmptyDraft(draft) {
    return !draft.productId && !String(draft.customerName || '').trim();
  }

  function saveDraft() {
    const draft = state.draft;
    if (!draft) return;
    const others = readDrafts().filter(item => item.id !== draft.id);
    if (isEmptyDraft(draft)) { writeJson(DRAFTS_KEY(), others); return; }
    draft.updatedAt = new Date().toISOString();
    writeJson(DRAFTS_KEY(), [draft, ...others].slice(0, 40));
  }

  function removeDraft(id) {
    writeJson(DRAFTS_KEY(), readDrafts().filter(item => item.id !== id));
  }

  const lastKeyOf = (customer, productId) => `${normalize(customer)}|${productId}`;
  function readLast() { const value = readJson(LAST_KEY(), {}); return value && typeof value === 'object' ? value : {}; }
  function lastFor(customer, productId) {
    if (!normalize(customer)) return null;
    return readLast()[lastKeyOf(customer, productId)] || null;
  }
  function rememberLast(draft) {
    if (!normalize(draft.customerName)) return;
    const all = readLast();
    all[lastKeyOf(draft.customerName, draft.productId)] = {
      customerName: draft.customerName.trim(),
      productName: draft.productName,
      components: draft.components.filter(line => line.quantity > 0),
      date: new Date().toISOString()
    };
    // Simpan paling banyak 300 racikan terakhir (yang terbaru menang).
    const entries = Object.entries(all).sort((a, b) => String(b[1].date).localeCompare(String(a[1].date))).slice(0, 300);
    writeJson(LAST_KEY(), Object.fromEntries(entries));
  }
  function knownCustomers() {
    const names = new Map();
    for (const item of Object.values(readLast())) if (item?.customerName) names.set(normalize(item.customerName), item.customerName);
    for (const draft of readDrafts()) if (draft.customerName) names.set(normalize(draft.customerName), draft.customerName);
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'id'));
  }

  // ---- Navigasi --------------------------------------------------------------
  function show(view) {
    const wasHome = state.view === 'home';
    state.view = view;
    $('rHomeView').hidden = view !== 'home';
    for (const step of STEPS) $(`r${step[0].toUpperCase()}${step.slice(1)}`).hidden = view !== step;
    $('rSteps').hidden = view === 'home';
    const index = STEPS.indexOf(view);
    for (const item of document.querySelectorAll('#rSteps [data-step]')) {
      const at = STEPS.indexOf(item.dataset.step);
      item.classList.toggle('done', at < index);
      item.toggleAttribute('aria-current', at === index);
    }
    // Tombol Back HP = "simpan sebagai draft", bukan keluar aplikasi.
    if (view !== 'home' && wasHome && !state.pushed && typeof history.pushState === 'function') {
      history.pushState({ racikStep: true }, '');
      state.pushed = true;
    }
    renderBar();
    window.scrollTo(0, 0);
  }

  function goHome(message) {
    if (state.draft && state.view !== 'nota') saveDraft();
    state.draft = null;
    show('home');
    renderHome();
    if (state.pushed) { state.pushed = false; history.back(); }
    if (message) toast(message);
  }

  window.addEventListener('popstate', () => {
    if (!state.pushed) return;
    state.pushed = false;
    if (state.view === 'home') return;
    const keep = state.draft && !isEmptyDraft(state.draft) && state.view !== 'nota';
    goHome(keep ? 'Disimpan sebagai draft.' : '');
  });

  function renderBar() {
    const view = state.view;
    const bar = $('rBar');
    bar.hidden = view === 'home' || !state.canWrite;
    const back = $('rBack');
    const next = $('rNext');
    next.disabled = state.busy;
    if (view === 'pesanan') {
      back.textContent = state.draft && !isEmptyDraft(state.draft) ? '← Simpan draft' : '← Batal';
      next.hidden = !state.draft?.productId;
      next.textContent = 'Lanjut racik';
    } else if (view === 'racik') {
      back.textContent = '← Simpan draft';
      next.hidden = false;
      next.textContent = 'Lanjut bayar';
    } else if (view === 'bayar') {
      back.textContent = '← Simpan draft';
      next.hidden = false;
      const price = currentPrice();
      next.textContent = state.busy ? 'Menyimpan…' : `Selesai · ${rupiah(price ?? 0)}`;
      next.disabled = state.busy || !payReady();
    } else if (view === 'nota') {
      back.textContent = '← Daftar racikan';
      next.hidden = false;
      next.textContent = 'Cetak nota';
    }
  }

  // ---- Beranda -----------------------------------------------------------------
  function timeAgo(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(minutes) || minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  function renderHome() {
    const drafts = readDrafts().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    $('rDraftsEmpty').hidden = drafts.length > 0;
    $('rDrafts').innerHTML = drafts.map(draft => `
      <div class="r-draft ${draft.stage === 'diracik' ? 'made' : ''}">
        <button type="button" class="r-draft-open" data-open="${esc(draft.id)}">
          <span class="r-draft-dot" style="--oil:${esc(oilOf(draft.productName || draft.customerName))}" aria-hidden="true"></span>
          <span><b>${esc(draft.customerName || 'Pembeli')}</b><small>${esc(draft.productName || 'Aroma belum dipilih')}</small></span>
          <span class="r-draft-meta"><em>${esc(STAGE_LABEL[draft.stage] || '')}</em><small>${esc(timeAgo(draft.updatedAt))}</small></span>
        </button>
        <button type="button" class="r-draft-del" data-del="${esc(draft.id)}" aria-label="Hapus draft ${esc(draft.customerName || '')}">✕</button>
      </div>`).join('');
    const nota = readJson(NOTA_KEY(), null);
    let reprint = $('rReprint');
    if (nota && !reprint) {
      reprint = document.createElement('button');
      reprint.id = 'rReprint';
      reprint.type = 'button';
      reprint.className = 'r-link';
      $('rHomeView').appendChild(reprint);
      reprint.addEventListener('click', () => { state.draft = null; renderReceipt(readJson(NOTA_KEY(), null)); show('nota'); });
    }
    if (reprint) {
      reprint.hidden = !nota;
      if (nota) reprint.textContent = `Lihat / cetak ulang nota terakhir (${nota.customerName} · ${nota.productName})`;
    }
  }

  function newDraft() {
    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stage: 'pesanan',
      customerName: '',
      productId: null,
      productName: '',
      recipeId: null,
      outputQuantity: 1,
      standard: [],
      components: [],
      from: 'standar',
      price: null,
      productionRunId: null
    };
  }

  function openDraft(id) {
    const draft = readDrafts().find(item => item.id === id);
    if (!draft) return renderHome();
    state.draft = draft;
    state.cash = null;
    if (draft.stage === 'diracik' || draft.stage === 'bayar') return openBayar();
    if (draft.stage === 'racik') return openRacik();
    openPesanan();
  }

  // ---- 1 · Pesanan -------------------------------------------------------------
  function openPesanan() {
    if (state.draft.stage === 'diracik') return openBayar();
    $('rCustomer').value = state.draft.customerName || '';
    $('rSearch').value = '';
    $('rCustomerList').innerHTML = knownCustomers().map(name => `<option value="${esc(name)}"></option>`).join('');
    show('pesanan');
    renderAromas();
    if (!state.draft.customerName) $('rCustomer').focus();
  }

  function renderAromas() {
    const query = normalize($('rSearch').value);
    const words = query ? query.split(' ') : [];
    const list = state.aromas.filter(aroma => words.every(word => normalize(aroma.productName).includes(word)));
    const customer = $('rCustomer').value;
    $('rAromas').innerHTML = list.map(aroma => {
      const last = lastFor(customer, aroma.productId);
      const chosen = Number(state.draft?.productId) === aroma.productId;
      return `<button type="button" class="r-aroma ${chosen ? 'chosen' : ''}" data-aroma="${aroma.productId}" style="--oil:${esc(oilOf(aroma.productName))}">
        <span class="r-aroma-drop" aria-hidden="true"></span>
        <b>${esc(aroma.productName)}</b>
        <small>${rupiah(state.prices.get(aroma.productId))}${aroma.capacityText ? ` · ${esc(aroma.capacityText)}` : ''}</small>
        ${last ? '<em>Pernah diracik</em>' : ''}
      </button>`;
    }).join('');
    const empty = $('rAromasEmpty');
    empty.hidden = list.length > 0;
    empty.textContent = query
      ? `"${$('rSearch').value.trim()}" tidak ketemu.`
      : 'Belum ada aroma yang bisa diracik. Di Workspace Gerai: buat barang aromanya, lalu buat resep standarnya (bahan + takaran).';
  }

  function chooseAroma(productId) {
    const aroma = state.aromas.find(item => item.productId === Number(productId));
    if (!aroma) return;
    const draft = state.draft;
    draft.customerName = $('rCustomer').value.trim();
    const sameAroma = Number(draft.productId) === aroma.productId && draft.components.length;
    draft.productId = aroma.productId;
    draft.productName = aroma.productName;
    draft.recipeId = aroma.recipeId;
    draft.outputQuantity = aroma.outputQuantity;
    draft.standard = aroma.components.map(line => ({ ...line }));
    if (sameAroma) { draft.stage = 'racik'; saveDraft(); return openRacik(); }
    draft.price = null;
    const last = lastFor(draft.customerName, aroma.productId);
    if (last) {
      $('rUseLastText').textContent = `${last.customerName}, ${new Date(last.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}: `
        + last.components.map(line => `${line.productName} ${qtyText(line.quantity)}${line.unitSymbol ? ` ${line.unitSymbol}` : ''}`).join(', ');
      $('rChoice').hidden = false;
      $('rUseLast').focus();
      return;
    }
    startRacik('standar');
  }

  function startRacik(from) {
    const draft = state.draft;
    $('rChoice').hidden = true;
    const source = from === 'terakhir' ? lastFor(draft.customerName, draft.productId)?.components : draft.standard;
    draft.components = (source || draft.standard).map(line => ({
      productId: Number(line.productId),
      productName: line.productName,
      unitSymbol: line.unitSymbol || state.materials.get(Number(line.productId))?.unitSymbol || '',
      quantity: Number(line.quantity) || 0
    }));
    draft.from = from;
    draft.stage = 'racik';
    saveDraft();
    openRacik();
  }

  // ---- 2 · Racik ----------------------------------------------------------------
  // Satuan "isi botol" = satuan bahan terbanyak di resep standar (mis. ml).
  // Bahan bersatuan lain (botol kemasan dalam pcs) tetap ditakar, tapi tidak
  // dihitung sebagai cairan di gambar botol.
  function fillUnit(lines) {
    const byUnit = new Map();
    for (const line of lines) byUnit.set(line.unitSymbol || '', (byUnit.get(line.unitSymbol || '') || 0) + Number(line.quantity || 0));
    let best = '';
    let max = -1;
    for (const [unit, total] of byUnit) if (total > max) { best = unit; max = total; }
    return best;
  }
  const liquid = (lines, unit) => lines.filter(line => (line.unitSymbol || '') === unit);
  const sumQty = lines => lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) || 0), 0);

  function openRacik() {
    if (state.draft.stage === 'diracik') return openBayar();
    state.draft.stage = 'racik';
    saveDraft();
    show('racik');
    renderRacik();
  }

  function renderBottle(lines, capacity) {
    const total = lines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
    const scale = Math.max(capacity, total, 1);
    const bottom = 170;
    const height = 124;
    let y = bottom;
    $('rLayers').innerHTML = lines.filter(line => line.quantity > 0).map(line => {
      const h = (line.quantity / scale) * height;
      y -= h;
      return `<rect x="0" y="${y.toFixed(2)}" width="120" height="${(h + 0.6).toFixed(2)}" fill="${esc(oilOf(line.productName))}"><title>${esc(line.productName)}</title></rect>`;
    }).join('');
    const brimY = bottom - (capacity / scale) * height;
    $('rBrim').setAttribute('y1', brimY.toFixed(2));
    $('rBrim').setAttribute('y2', brimY.toFixed(2));
    $('rBrim').style.display = capacity > 0 ? '' : 'none';
    $('rBottle').classList.toggle('over', total > capacity && capacity > 0);
  }

  function renderRacik() {
    const draft = state.draft;
    const lines = draft.components;
    const unit = fillUnit(draft.standard.length ? draft.standard : lines);
    const capacity = sumQty(liquid(draft.standard, unit));
    const total = sumQty(liquid(lines, unit));
    const u = unit ? ` ${unit}` : '';
    $('rForWho').textContent = `Untuk ${draft.customerName || 'pembeli'}`;
    $('rAromaName').textContent = draft.productName;
    const diff = total - capacity;
    $('rFillText').innerHTML = `<b>${qtyText(total)}</b> / ${qtyText(capacity)}${esc(u)}`
      + `<span class="${diff === 0 ? 'ok' : diff > 0 ? 'over' : 'under'}">${diff === 0 ? 'Pas' : diff > 0 ? `Lebih ${qtyText(diff)}${esc(u)}` : `Kurang ${qtyText(-diff)}${esc(u)}`}</span>`;
    $('rFromText').textContent = draft.from === 'terakhir' ? 'Dari racikan terakhir pelanggan ini' : 'Dari resep standar';
    renderBottle(liquid(lines, unit), capacity);

    const short = [];
    $('rLines').innerHTML = lines.map((line, index) => {
      const material = state.materials.get(Number(line.productId));
      const stock = material?.stockQuantity;
      const low = stock !== null && stock !== undefined && line.quantity > stock;
      if (low) short.push(`${line.productName} tinggal ${qtyText(stock)}${line.unitSymbol ? ` ${line.unitSymbol}` : ''}`);
      const standard = draft.standard.find(item => Number(item.productId) === Number(line.productId));
      const changed = !standard || Number(standard.quantity) !== Number(line.quantity);
      return `<li class="r-line ${low ? 'low' : ''}" style="--oil:${esc(oilOf(line.productName))}">
        <span class="r-line-swatch" aria-hidden="true"></span>
        <div class="r-line-name"><b>${esc(line.productName)}</b>
          <small>${changed ? (standard ? `standar ${qtyText(standard.quantity)}${line.unitSymbol ? ` ${esc(line.unitSymbol)}` : ''}` : 'bahan tambahan') : 'sesuai standar'}${low ? ` · stok tinggal ${qtyText(stock)}` : ''}</small></div>
        <div class="r-stepper">
          <button type="button" data-dec="${index}" aria-label="Kurangi ${esc(line.productName)}">−</button>
          <input type="text" inputmode="numeric" value="${esc(line.quantity)}" data-qty="${index}" aria-label="Takaran ${esc(line.productName)}" />
          <span class="r-unit">${esc(line.unitSymbol || '')}</span>
          <button type="button" data-inc="${index}" aria-label="Tambah ${esc(line.productName)}">+</button>
        </div>
        <button type="button" class="r-line-del" data-remove="${index}" aria-label="Buang ${esc(line.productName)}">✕</button>
      </li>`;
    }).join('');
    $('rWarn').hidden = short.length === 0;
    $('rWarn').textContent = short.length ? `Stok di catatan kurang: ${short.join('; ')}. Tetap bisa diracik, stok tercatat minus sampai belanja bahan dicatat.` : '';
    renderBar();
  }

  function setLineQty(index, quantity) {
    const line = state.draft.components[index];
    if (!line) return;
    line.quantity = Math.max(0, Math.min(MAX_QTY, Math.round(Number(quantity) || 0)));
    saveDraft();
    renderRacik();
  }

  function racikReady() {
    const lines = state.draft.components.filter(line => line.quantity > 0);
    if (!lines.length) { toast('Isi takaran minimal satu bahan.'); return false; }
    if (lines.some(line => !Number.isInteger(line.quantity))) { toast('Takaran harus bilangan bulat.'); return false; }
    return true;
  }

  function openPicker() {
    $('rPickerSearch').value = '';
    $('rPicker').hidden = false;
    renderPicker();
    $('rPickerSearch').focus();
  }

  function renderPicker() {
    const used = new Set(state.draft.components.map(line => Number(line.productId)));
    const query = normalize($('rPickerSearch').value);
    const words = query ? query.split(' ') : [];
    const list = [...state.materials.values()]
      .filter(item => item.productId !== Number(state.draft.productId) && !used.has(item.productId))
      .filter(item => words.every(word => normalize(item.productName).includes(word)))
      .slice(0, 60);
    $('rPickerList').innerHTML = list.length
      ? list.map(item => `<button type="button" class="r-pick" data-pick="${item.productId}" style="--oil:${esc(oilOf(item.productName))}">
          <span class="r-line-swatch" aria-hidden="true"></span><b>${esc(item.productName)}</b>
          <small>${item.stockQuantity === null || item.stockQuantity === undefined ? '' : `stok ${qtyText(item.stockQuantity)}${item.unitSymbol ? ` ${esc(item.unitSymbol)}` : ''}`}</small></button>`).join('')
      : '<p class="r-empty">Bahan tidak ketemu. Bahan baru ditambahkan lewat Master Barang.</p>';
  }

  function addMaterial(productId) {
    const material = state.materials.get(Number(productId));
    if (!material) return;
    state.draft.components.push({ productId: material.productId, productName: material.productName, unitSymbol: material.unitSymbol || '', quantity: 1 });
    $('rPicker').hidden = true;
    saveDraft();
    renderRacik();
    const inputs = document.querySelectorAll('#rLines [data-qty]');
    inputs[inputs.length - 1]?.select();
  }

  // ---- 3 · Bayar ----------------------------------------------------------------
  const listPrice = () => Math.round(Number(state.prices.get(Number(state.draft?.productId)) || 0));
  const currentPrice = () => (state.draft?.price ?? listPrice());

  function isCash() { return state.method === 'CASH' || !state.methods.length; }

  function payReady() {
    const price = currentPrice();
    if (!Number.isInteger(price) || price < 0 || price > MAX_PRICE) return false;
    if (isCash()) return state.cash !== null && state.cash >= price * state.draft.outputQuantity;
    return true;
  }

  function formulaText(lines) {
    return lines.filter(line => line.quantity > 0).map(line => `${line.productName} ${qtyText(line.quantity)}${line.unitSymbol ? ` ${line.unitSymbol}` : ''}`).join(' · ');
  }

  function openBayar() {
    const draft = state.draft;
    if (draft.stage !== 'diracik') draft.stage = 'bayar';
    saveDraft();
    state.cash = null;
    $('rCash').value = '';
    $('rPayFor').textContent = `Untuk ${draft.customerName || 'pembeli'}${draft.stage === 'diracik' ? ' · sudah diracik' : ''}`;
    $('rPayAroma').textContent = draft.productName;
    $('rPayFormula').textContent = formulaText(draft.components);
    $('rPrice').value = currentPrice().toLocaleString('id-ID');
    show('bayar');
    renderBayar();
  }

  function quickAmounts(total) {
    const picks = [total];
    for (const step of [10000, 50000, 100000]) {
      const value = Math.ceil(total / step) * step;
      if (value > total && !picks.includes(value)) picks.push(value);
    }
    return picks.sort((a, b) => a - b).slice(0, 4);
  }

  function renderBayar() {
    const price = currentPrice();
    const list = listPrice();
    const total = price * state.draft.outputQuantity;
    $('rPriceNote').textContent = price === list
      ? `Harga daftar ${rupiah(list)}. Boleh diubah.`
      : `Harga daftar ${rupiah(list)} → dijual ${rupiah(price)}. Perubahan ini tercatat di penjualan.`;
    $('rPriceNote').classList.toggle('changed', price !== list);
    $('rMethods').innerHTML = state.methods.length > 1
      ? state.methods.map(method => `<button type="button" class="r-method" data-method="${esc(method.code)}" aria-pressed="${method.code === state.method}">${esc(method.name)}</button>`).join('')
      : '';
    $('rCashBox').hidden = !isCash();
    if (isCash()) {
      $('rQuick').innerHTML = quickAmounts(total).map((value, index) =>
        `<button type="button" data-cash="${value}" aria-pressed="${state.cash === value}">${index === 0 ? 'Uang pas' : rupiah(value)}</button>`).join('');
      const change = state.cash === null ? null : state.cash - total;
      $('rChange').parentElement.classList.toggle('short', change !== null && change < 0);
      $('rChangeLabel').textContent = change !== null && change < 0 ? 'Uang kurang' : 'Kembalian';
      $('rChange').textContent = change === null ? '—' : rupiah(Math.abs(change));
    }
    renderBar();
  }

  async function finish() {
    if (state.busy || !payReady()) return;
    const draft = state.draft;
    const price = currentPrice();
    const components = draft.components.filter(line => line.quantity > 0);
    state.busy = true;
    renderBar();
    try {
      if (draft.stage !== 'diracik') {
        const made = await api('/api/cashier/production', {
          method: 'POST',
          body: JSON.stringify({
            outputProductId: draft.productId,
            outputQuantity: draft.outputQuantity,
            recipeId: draft.recipeId,
            components: components.map(line => ({ productId: line.productId, quantity: line.quantity }))
          })
        });
        draft.stage = 'diracik';
        draft.productionRunId = made.production?.id || null;
        rememberLast(draft);
        saveDraft();
      }
      const body = {
        items: [{ productId: draft.productId, quantity: draft.outputQuantity, productionMode: 'STOCK', unitPrice: price }],
        customerName: draft.customerName || 'Pembeli',
        note: `Racikan: ${formulaText(components)}`.slice(0, 500)
      };
      if (state.methods.length) body.paymentMethod = state.method;
      const sold = await api('/api/cashier/sales', { method: 'POST', body: JSON.stringify(body) });
      const total = Number(sold.sale?.total ?? price * draft.outputQuantity);
      const methodName = state.methods.find(method => method.code === state.method)?.name || 'Tunai';
      const receipt = {
        storeName: state.storeName,
        cashierName: state.cashierName,
        orderNo: sold.order?.orderNo || '',
        createdAt: sold.sale?.createdAt || new Date().toISOString(),
        customerName: draft.customerName || 'Pembeli',
        productName: draft.productName,
        quantity: draft.outputQuantity,
        components,
        total,
        methodName: isCash() ? 'Tunai' : methodName,
        cash: isCash() ? state.cash : null,
        change: isCash() ? state.cash - total : null
      };
      writeJson(NOTA_KEY(), receipt);
      removeDraft(draft.id);
      state.draft = null;
      renderReceipt(receipt);
      show('nota');
      try { navigator.vibrate?.(60); } catch {}
    } catch (error) {
      if (draft.stage === 'diracik') {
        renderBayar();
        toast(`Botol sudah diracik dan tersimpan. Pembayaran belum tercatat: ${error.message}`);
        $('rPayFor').textContent = `Untuk ${draft.customerName || 'pembeli'} · sudah diracik`;
      } else {
        toast(error.message);
      }
    } finally {
      state.busy = false;
      renderBar();
    }
  }

  // ---- 4 · Nota -----------------------------------------------------------------
  function renderReceipt(receipt) {
    if (!receipt) return;
    const when = new Date(receipt.createdAt);
    const showFormula = $('rShowFormula').checked;
    $('rReceipt').innerHTML = `
      <header><h2>${esc(receipt.storeName || 'Toko Parfum')}</h2><small>Nota racikan</small></header>
      <dl>
        <div><dt>Tanggal</dt><dd>${esc(when.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }))} ${esc(when.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))}</dd></div>
        ${receipt.orderNo ? `<div><dt>No.</dt><dd>${esc(receipt.orderNo)}</dd></div>` : ''}
        <div><dt>Pelanggan</dt><dd>${esc(receipt.customerName)}</dd></div>
        ${receipt.cashierName ? `<div><dt>Diracik</dt><dd>${esc(receipt.cashierName)}</dd></div>` : ''}
      </dl>
      <div class="r-rc-item"><b>${esc(receipt.productName)}</b><span>${receipt.quantity > 1 ? `${receipt.quantity} × ` : ''}${rupiah(receipt.total / (receipt.quantity || 1))}</span></div>
      ${showFormula ? `<ul class="r-rc-formula">${receipt.components.map(line => `<li><span>${esc(line.productName)}</span><span>${qtyText(line.quantity)}${line.unitSymbol ? ` ${esc(line.unitSymbol)}` : ''}</span></li>`).join('')}</ul>` : ''}
      <div class="r-rc-total"><span>Total</span><b>${rupiah(receipt.total)}</b></div>
      <div class="r-rc-row"><span>${esc(receipt.methodName)}</span><span>${rupiah(receipt.cash ?? receipt.total)}</span></div>
      ${receipt.change !== null && receipt.change !== undefined ? `<div class="r-rc-row"><span>Kembalian</span><span>${rupiah(receipt.change)}</span></div>` : ''}
      <footer>Terima kasih. Simpan nota ini untuk pesan racikan yang sama.</footer>`;
    state.receipt = receipt;
  }

  // ---- Siap meracik? ----------------------------------------------------------------
  function showGate(title, text, button, href) {
    $('rGate').hidden = false;
    $('rHomeView').hidden = true;
    for (const step of STEPS) $(`r${step[0].toUpperCase()}${step.slice(1)}`).hidden = true;
    $('rSteps').hidden = true;
    $('rBar').hidden = true;
    $('rGateTitle').textContent = title;
    $('rGateText').textContent = text;
    $('rGateBtn').textContent = button;
    $('rGateBtn').href = href;
    $('rGateBtn').hidden = false;
    $('rOpenBox').hidden = true;
  }

  // Skin F: siapa pun yang login (kasir, pemilik, admin) langsung buka laci
  // di sini, tanpa absen (server: cashier.store.attendanceOptional).
  function showOpenGate(lastClosing) {
    const hasLast = lastClosing !== null && lastClosing !== undefined;
    showGate('Laci belum dibuka', hasLast
      ? `Uang di laci dari penutupan terakhir ${rupiah(lastClosing)}. Tinggal buka.`
      : 'Pertama kali buka: berapa uang di laci sekarang? (boleh 0)', '', '#');
    $('rGateBtn').hidden = true;
    $('rOpenBox').hidden = false;
    $('rOpenCashLabel').hidden = hasLast;
    $('rOpenCash').hidden = hasLast;
    state.lastClosing = hasLast ? lastClosing : null;
  }

  async function openDrawer() {
    if (state.busy) return;
    const amount = state.lastClosing ?? digits($('rOpenCash').value);
    if (amount === null || amount === undefined) return toast('Ketik dulu uang di laci sekarang (boleh 0).');
    state.busy = true;
    $('rOpenBtn').disabled = true;
    try {
      await api('/api/cashier/drawer/open', { method: 'POST', body: JSON.stringify({ openingAmount: amount, shiftLabel: 'Racik' }) });
      toast('Laci dibuka. Selamat meracik!');
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      state.busy = false;
      $('rOpenBtn').disabled = false;
    }
  }

  async function load() {
    if (!localStorage.getItem('lekerCashierToken')) {
      location.replace(exitPath());
      return;
    }
    $('rFullCashier').href = cashierPath('?lengkap=1');
    $('rOwnerPanel').hidden = !ownerMode();
    $('rOwnerPanel').href = ownerReturn();
    $('rLogout').textContent = ownerMode() ? 'Selesai jualan (kembali ke panel)' : 'Keluar';
    try {
      const [me, drawer] = await Promise.all([api('/api/cashier/me'), api('/api/cashier/drawer')]);
      const cashier = me.cashier || drawer.cashier || {};
      state.storeName = cashier.store?.storeName || window.MaxiSkin?.brand?.() || 'Toko Parfum';
      state.cashierName = cashier.employeeName || cashier.username || '';
      $('rStoreName').textContent = state.storeName;
      $('rWho').textContent = state.cashierName ? `Diracik ${state.cashierName}` : '';
      state.canWrite = Boolean(drawer.canWrite);
      const attendanceOptional = Boolean(cashier.store?.attendanceOptional);
      if (!attendanceOptional && me.attendanceStatus !== 'in') {
        showGate('Belum absen', 'Absen dulu dengan foto, lalu buka laci. Setelah itu kembali ke sini untuk meracik.', 'Absen & buka toko', cashierPath('?lengkap=1'));
        return;
      }
      if (!drawer.drawer && attendanceOptional) {
        showOpenGate(drawer.lastClosingAmount ?? null);
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
      const [options, menu, workspace] = await Promise.all([
        api('/api/cashier/production/options'),
        api('/api/cashier/menu'),
        api('/api/cashier/workspace').catch(() => ({}))
      ]);
      state.prices = new Map((menu.products || []).map(product => [Number(product.id), Number(product.price)]));
      const seen = new Set();
      state.aromas = (options.products || [])
        .filter(product => state.prices.has(Number(product.productId)) && !seen.has(Number(product.productId)) && seen.add(Number(product.productId)))
        .map(product => {
          const recipe = product.recipes?.[0] || {};
          const components = (recipe.components || []).map(line => ({ productId: Number(line.productId), productName: line.productName, unitSymbol: line.unitSymbol || '', quantity: Number(line.quantity) || 0 }));
          const unit = fillUnit(components);
          const capacity = sumQty(liquid(components, unit));
          return {
            productId: Number(product.productId),
            productName: product.productName,
            recipeId: recipe.recipeId || product.recipeId,
            outputQuantity: Math.max(1, Number(recipe.outputQuantity) || 1),
            components,
            capacityText: capacity && unit ? `${qtyText(capacity)} ${unit}` : ''
          };
        });
      state.materials = new Map((options.materials || []).map(item => [Number(item.productId), { ...item, productId: Number(item.productId) }]));
      state.methods = (Array.isArray(workspace.paymentMethods) ? workspace.paymentMethods : [])
        .filter(method => !['PAYABLE', 'NON_CASH'].includes(String(method.code).toUpperCase()))
        .map(method => (method.code === 'CASH' ? { ...method, name: 'Tunai' } : method));
      state.method = state.methods.find(item => item.isDefault)?.code || state.methods.find(item => item.code === 'CASH')?.code || state.methods[0]?.code || 'CASH';
      $('rGate').hidden = true;
      if (state.view === 'home' || !state.draft) { show('home'); renderHome(); }
      else if (state.view === 'pesanan') renderAromas();
      else if (state.view === 'racik') renderRacik();
      else if (state.view === 'bayar') renderBayar();
    } catch (error) {
      showGate('Belum bisa dibuka', error.message, 'Coba lagi', location.href);
    }
  }

  // ---- Event ------------------------------------------------------------------------
  $('rHome').addEventListener('click', () => { if (state.view !== 'home') goHome(state.draft && !isEmptyDraft(state.draft) && state.view !== 'nota' ? 'Disimpan sebagai draft.' : ''); });
  $('rNew').addEventListener('click', () => { state.draft = newDraft(); openPesanan(); });
  $('rDrafts').addEventListener('click', event => {
    const open = event.target.closest('[data-open]');
    const del = event.target.closest('[data-del]');
    if (open) openDraft(open.dataset.open);
    if (del) {
      const draft = readDrafts().find(item => item.id === del.dataset.del);
      if (!draft) return;
      const message = draft.stage === 'diracik'
        ? `Botol ${draft.productName} untuk ${draft.customerName || 'pembeli'} SUDAH diracik dan stoknya tercatat. Menghapus draft tidak membatalkan racikan; botolnya tetap ada di stok dan bisa dijual lewat Kasir lengkap. Hapus draft?`
        : `Hapus draft ${draft.productName || ''} untuk ${draft.customerName || 'pembeli'}?`;
      if (confirm(message)) { removeDraft(draft.id); renderHome(); }
    }
  });
  $('rCustomer').addEventListener('input', () => { state.draft.customerName = $('rCustomer').value; saveDraft(); renderAromas(); renderBar(); });
  $('rSearch').addEventListener('input', renderAromas);
  $('rAromas').addEventListener('click', event => {
    const button = event.target.closest('[data-aroma]');
    if (button) chooseAroma(button.dataset.aroma);
  });
  $('rUseLast').addEventListener('click', () => startRacik('terakhir'));
  $('rUseStandard').addEventListener('click', () => startRacik('standar'));
  $('rChoiceClose').addEventListener('click', () => { $('rChoice').hidden = true; });

  $('rLines').addEventListener('click', event => {
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    const remove = event.target.closest('[data-remove]');
    if (inc) setLineQty(Number(inc.dataset.inc), state.draft.components[Number(inc.dataset.inc)].quantity + 1);
    if (dec) setLineQty(Number(dec.dataset.dec), state.draft.components[Number(dec.dataset.dec)].quantity - 1);
    if (remove) { state.draft.components.splice(Number(remove.dataset.remove), 1); saveDraft(); renderRacik(); }
  });
  $('rLines').addEventListener('change', event => {
    const input = event.target.closest('[data-qty]');
    if (input) setLineQty(Number(input.dataset.qty), digits(input.value) ?? 0);
  });
  $('rLines').addEventListener('focusin', event => { event.target.closest('[data-qty]')?.select(); });
  $('rAddLine').addEventListener('click', openPicker);
  $('rReset').addEventListener('click', () => { if (confirm('Kembalikan semua takaran ke resep standar?')) startRacik('standar'); });
  $('rPickerSearch').addEventListener('input', renderPicker);
  $('rPickerList').addEventListener('click', event => { const pick = event.target.closest('[data-pick]'); if (pick) addMaterial(pick.dataset.pick); });
  $('rPickerClose').addEventListener('click', () => { $('rPicker').hidden = true; });
  for (const id of ['rPicker', 'rChoice']) $(id).addEventListener('click', event => { if (event.target.id === id) $(id).hidden = true; });

  $('rPrice').addEventListener('input', () => {
    const value = digits($('rPrice').value);
    $('rPrice').value = value === null ? '' : value.toLocaleString('id-ID');
    state.draft.price = value === null ? 0 : Math.min(MAX_PRICE, value);
    state.cash = null;
    $('rCash').value = '';
    saveDraft();
    renderBayar();
  });
  $('rPrice').addEventListener('focus', () => $('rPrice').select());
  $('rMethods').addEventListener('click', event => {
    const button = event.target.closest('[data-method]');
    if (!button) return;
    state.method = button.dataset.method;
    renderBayar();
  });
  $('rQuick').addEventListener('click', event => {
    const button = event.target.closest('[data-cash]');
    if (!button) return;
    state.cash = Number(button.dataset.cash);
    $('rCash').value = '';
    renderBayar();
  });
  $('rCash').addEventListener('input', () => {
    state.cash = digits($('rCash').value);
    $('rCash').value = state.cash === null ? '' : state.cash.toLocaleString('id-ID');
    renderBayar();
  });
  $('rShowFormula').addEventListener('change', () => renderReceipt(state.receipt));

  $('rBack').addEventListener('click', () => {
    const keep = state.draft && !isEmptyDraft(state.draft) && state.view !== 'nota';
    goHome(keep ? 'Disimpan sebagai draft. Lanjutkan kapan saja dari daftar ini.' : '');
  });
  $('rNext').addEventListener('click', () => {
    if (state.view === 'pesanan' && state.draft?.productId) {
      state.draft.customerName = $('rCustomer').value.trim();
      if (state.draft.components.length) openRacik(); else chooseAroma(state.draft.productId);
    } else if (state.view === 'racik') {
      if (racikReady()) openBayar();
    } else if (state.view === 'bayar') {
      finish();
    } else if (state.view === 'nota') {
      window.print();
    }
  });
  $('rSteps').addEventListener('click', event => {
    const item = event.target.closest('[data-step]');
    if (!item || !state.draft || state.busy) return;
    const target = item.dataset.step;
    if (STEPS.indexOf(target) >= STEPS.indexOf(state.view)) return;
    if (state.draft.stage === 'diracik') return toast('Botol ini sudah diracik; takarannya tidak bisa diubah lagi.');
    if (target === 'pesanan') openPesanan();
    if (target === 'racik') openRacik();
  });

  $('rMoreBtn').addEventListener('click', () => {
    const menu = $('rMoreMenu');
    menu.hidden = !menu.hidden;
    $('rMoreBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#rMoreMenu, #rMoreBtn')) { $('rMoreMenu').hidden = true; $('rMoreBtn').setAttribute('aria-expanded', 'false'); }
  });
  $('rOpenBtn').addEventListener('click', openDrawer);
  $('rOpenCash').addEventListener('input', () => { const value = digits($('rOpenCash').value); $('rOpenCash').value = value === null ? '' : value.toLocaleString('id-ID'); });
  $('rRefresh').addEventListener('click', () => { $('rMoreMenu').hidden = true; load(); });
  $('rLogout').addEventListener('click', async () => {
    if (state.draft) saveDraft();
    const backToPanel = ownerMode();
    const panelPath = ownerReturn();
    try { await api('/api/cashier/logout', { method: 'POST' }); } catch {}
    try {
      localStorage.removeItem('lekerCashierToken');
      // Mode pemilik: sesi Pemilik di panel tetap jalan, jangan hapus identitasnya.
      if (backToPanel) localStorage.removeItem(OWNER_KEY);
      else localStorage.removeItem('lekerStaffSessionMeta');
    } catch {}
    location.replace(backToPanel ? panelPath : cashierPath());
  });

  // Layar ini hanya untuk skin F. Kalau Owner mengganti tampilan tenant, HP
  // yang sedang membuka layar Racik pulang ke Kasir biasa (pola warung.js).
  function pulangKalauBukanSkinRacik() {
    const skin = window.MaxiSkin?.skin?.();
    if (!skin || skin === 'f') return false;
    if (state.draft) saveDraft();
    location.replace(cashierPath());
    return true;
  }
  window.addEventListener('maxi-skin-change', pulangKalauBukanSkinRacik);

  // Refresh saat kembali ke tab (bukan polling -- invariant #6).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    Promise.resolve(window.MaxiSkin?.refresh?.()).then(pulangKalauBukanSkinRacik, () => {});
    if (state.view === 'home' && !state.busy) load();
  });

  load();
  Promise.resolve(window.MaxiSkin?.ready).then(pulangKalauBukanSkinRacik, () => {});
})();
