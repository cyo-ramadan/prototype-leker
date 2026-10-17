// Cek QRIS di panel kasir (Bos Cyo, 2026-10-16/17). Tidak ada tombol baru di kasir: cek QRIS
// menumpang tombol "📚 Detail Laci" yang sudah ada (cashier-enhancements.js) -- tombol itu diberi
// angka penjualan QRIS yang belum tertaut, dan jendela Detail Laci diberi baris "📲 Cek QRIS".
// Tampilan & aturan ada di qris-otomatis.js / src/qris-otomatis.js. Bunyi dipicu notifikasi
// QRIS_MASUK lewat saluran notifikasi langsung (WebSocket, user-notifications.js) -- tanpa polling.
// Saat aplikasi ditutup, notifikasi HP (push) yang memberi tahu CS.
(() => {
  if (!window.QrisOtomatis) return;
  const laciBtn = () => document.getElementById('drawerHistoryBtn');
  let summary = { enabled: false };

  const storeCode = () => String(state.cashier?.store?.code || '').trim().toUpperCase();
  const seen = new Set();
  let primed = false;
  let audio = null;

  // Browser hanya mengizinkan bunyi setelah ada sentuhan; kasir menyentuh layar terus, jadi
  // AudioContext disiapkan pada sentuhan pertama.
  const unlock = () => {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      audio.resume?.();
    } catch {}
  };
  window.addEventListener('pointerdown', unlock, { passive: true });

  function cring() {
    if (!audio || audio.state !== 'running') return;
    try {
      [[1318, 0], [1760, 0.12], [2093, 0.24]].forEach(([freq, at]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.connect(gain); gain.connect(audio.destination);
        const start = audio.currentTime + at;
        gain.gain.setValueAtTime(0.25, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.start(start); osc.stop(start + 0.36);
      });
    } catch {}
  }

  function banner(title, body) {
    let node = document.getElementById('qrisBanner');
    if (!node) {
      node = document.createElement('button');
      node.id = 'qrisBanner';
      node.type = 'button';
      node.className = 'qris-banner';
      node.onclick = () => { node.classList.remove('show'); openDialog(); };
      document.body.appendChild(node);
    }
    node.innerHTML = `<strong></strong><span></span>`;
    node.querySelector('strong').textContent = title;
    node.querySelector('span').textContent = body;
    node.classList.add('show');
    clearTimeout(banner.timer);
    banner.timer = setTimeout(() => node.classList.remove('show'), 8000);
  }

  function mine() {
    return (summary.stores || []).find(item => item.storeCode === storeCode()) || { penjualanBelum: 0, masukBelum: 0 };
  }

  // Angka di tombol Detail Laci = penjualan QRIS hari ini yang belum tertaut.
  function paintLaciBtn() {
    const button = laciBtn();
    if (!button) return;
    button.querySelector('.qris-laci-badge')?.remove();
    const belum = summary.enabled ? mine().penjualanBelum : 0;
    if (belum) button.insertAdjacentHTML('beforeend', ` <span class="info-gerai-badge qris-laci-badge" title="Penjualan QRIS belum tertaut">QRIS ${belum}</span>`);
  }

  // Baris "📲 Cek QRIS" di atas jendela Detail Laci.
  function paintLaciStrip() {
    const dialog = document.getElementById('cashierDrawerHistoryDialog');
    if (!dialog) return;
    let strip = document.getElementById('qrisLaciStrip');
    if (!summary.enabled) { strip?.remove(); return; }
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'qrisLaciStrip';
      strip.className = 'qris-laci-strip';
      dialog.querySelector('.cashier-dialog-head')?.after(strip);
    }
    const { penjualanBelum, masukBelum } = mine();
    const status = penjualanBelum || masukBelum
      ? `<span class="status-chip warn">${penjualanBelum} penjualan belum tertaut</span>${masukBelum ? ` <span class="status-chip bad">${masukBelum} uang masuk tanpa penjualan</span>` : ''}`
      : '<span class="status-chip ok">Semua QRIS hari ini tertaut</span>';
    const kolam = summary.kolam
      ? `<div class="qris-laci-status"><span class="status-chip ${summary.kolamBelum ? 'bad' : 'ok'}">🧾 Kolam: ${summary.kolamBelum} belum diklaim</span></div>` : '';
    strip.innerHTML = `<div><strong>📲 Cek QRIS hari ini</strong><div class="qris-laci-status">${status}</div>${kolam}</div>
      <button class="primary-btn" type="button" data-qris-laci>${summary.kolam ? 'Buka Kolam QRIS' : 'Buka Cek QRIS'}</button>`;
    strip.querySelector('[data-qris-laci]').onclick = openDialog;
  }

  async function refresh() {
    if (!state.cashier || !storeCode()) return;
    summary = await window.QrisOtomatis.ringkasan(api, storeCode());
    paintLaciBtn();
    paintLaciStrip();
  }

  function openDialog() {
    if (!storeCode()) return toast('Gerai kasir belum terbaca. Login ulang lalu coba lagi.');
    window.QrisOtomatis.open({ api, storeCode: storeCode(), kolam: Boolean(summary.kolam), onClose: refresh });
  }
  // Tombol Detail Laci dibuat cashier-enhancements.js; pasang sesudah ia ada.
  document.addEventListener('click', event => {
    if (event.target.closest?.('#drawerHistoryBtn')) setTimeout(() => { paintLaciStrip(); refresh(); }, 0);
  });

  document.addEventListener('maxi-notifications-changed', event => {
    const items = (event.detail?.items || []).filter(item => item.kind === 'QRIS_MASUK');
    const fresh = items.filter(item => !seen.has(item.id));
    fresh.forEach(item => seen.add(item.id));
    if (!primed) { primed = true; return; } // notifikasi lama saat halaman dibuka tidak dibunyikan
    const baru = fresh.filter(item => !item.readAt);
    if (!baru.length) return;
    cring();
    banner(baru[0].title, baru.length > 1 ? `+${baru.length - 1} lainnya · ketuk untuk melihat` : `${baru[0].body}`);
    refresh();
    window.QrisOtomatis.refreshIfOpen();
  });

  const original = window.openDashboard;
  if (typeof original === 'function') {
    window.openDashboard = async function (...args) {
      const result = await original.apply(this, args);
      refresh();
      return result;
    };
  }
  window.addEventListener('focus', refresh);
  refresh();
})();
