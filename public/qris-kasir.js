// QRIS di panel kasir (Bos Cyo, 2026-10-16/17). Tidak ada tombol baru di kasir: QRIS ada di menu
// "📊 Data" (kolom & filter Cara bayar, tombol kecil QRIS merah/hijau per penjualan, tombol
// "Kolam QRIS" di sebelah Stok) -- cashier-data-explorer.js. Di sini:
// - sesudah penjualan QRIS/campuran tersimpan, langsung tawarkan "Pilih uang QRIS-nya" supaya CS
//   mengunci uangnya sebelum gerai lain mengklaim (notifikasi Merchant BCA masuk < 2 detik). Saklar
//   qris_tautan_sistem ON (bawaan, 2026-10-19): server menjawab tautanSistem dan jendelanya tidak muncul --
//   CS cukup mengklaim di Kolam QRIS, sistem yang menautkan dari mutasi H+1;
// - mode tanpa kolam bersama: bunyi + pita hijau saat notifikasi QRIS_MASUK datang lewat saluran
//   notifikasi langsung (WebSocket, user-notifications.js) -- tanpa polling.
// Tampilan & aturan ada di qris-otomatis.js / src/qris-otomatis.js.
(() => {
  if (!window.QrisOtomatis) return;

  const storeCode = () => String(state.cashier?.store?.code || '').trim().toUpperCase();
  window.qrisKasirStoreCode = storeCode;
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

  function openDialog() {
    if (!storeCode()) return toast('Gerai kasir belum terbaca. Login ulang lalu coba lagi.');
    window.QrisOtomatis.open({ api, storeCode: storeCode(), tab: 'HARIAN' });
  }

  // Sesudah penjualan non-tunai tersimpan (event dari cashier-payment-methods.js): bila penjualan
  // itu memakai QRIS (atau campuran dengan bagian QRIS), langsung buka pemilih uang masuk.
  document.addEventListener('cashier:sale-saved', event => {
    const sale = event.detail?.sale;
    if (!sale?.id || sale.paymentMethod === 'CASH') return;
    window.QrisOtomatis.pilihPenjualan({ api, saleId: sale.id, otomatis: true });
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
    window.QrisOtomatis.refreshIfOpen();
  });
})();
