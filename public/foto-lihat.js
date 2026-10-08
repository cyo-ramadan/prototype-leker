// Penampil foto di halaman yang sama (Bos Cyo, 2026-10-08: "potonya masih belum bisa dibuka").
// Foto bukti setoran diambil lewat fetch berkunci (Authorization), jadi alamatnya berupa
// blob: lokal. Membuka blob: di tab baru (window.open) gagal di banyak HP -- aplikasi yang
// dipasang di layar utama, browser bawaan WhatsApp, dan beberapa Chrome Android menampilkan
// halaman kosong atau menolak. Di sini foto dibuka sebagai lapisan penuh layar di halaman yang
// sama; cubit untuk memperbesar, ketuk "Tutup" atau tombol Kembali untuk menutup.
(() => {
  if (window.MAXIFotoLihat) return;
  let lapisan = null;

  function tutup() {
    if (!lapisan) return;
    lapisan.remove();
    lapisan = null;
    document.removeEventListener('keydown', onKey);
  }
  function onKey(event) { if (event.key === 'Escape') tutup(); }

  function buka(url, judul = 'Foto bukti') {
    if (!url) return;
    tutup();
    lapisan = document.createElement('div');
    lapisan.setAttribute('role', 'dialog');
    lapisan.setAttribute('aria-modal', 'true');
    lapisan.setAttribute('aria-label', judul);
    lapisan.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(10,8,6,.92);display:flex;flex-direction:column;touch-action:pinch-zoom';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;color:#fff;font:600 14px/1.3 system-ui,sans-serif';
    const label = document.createElement('span');
    label.textContent = judul;
    const aksi = document.createElement('span');
    aksi.style.cssText = 'display:flex;gap:8px';
    const unduh = document.createElement('a');
    unduh.href = url;
    unduh.download = 'bukti-transfer.jpg';
    unduh.textContent = 'Simpan';
    unduh.style.cssText = 'color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:10px;padding:8px 12px;text-decoration:none';
    const tombolTutup = document.createElement('button');
    tombolTutup.type = 'button';
    tombolTutup.textContent = 'Tutup';
    tombolTutup.style.cssText = 'background:#fff;color:#1f1a16;border:0;border-radius:10px;padding:8px 14px;font:inherit;cursor:pointer';
    tombolTutup.addEventListener('click', tutup);
    aksi.append(unduh, tombolTutup);
    bar.append(label, aksi);
    const wadah = document.createElement('div');
    wadah.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:0 8px 12px';
    const img = document.createElement('img');
    img.src = url;
    img.alt = judul;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;background:#fff';
    wadah.append(img);
    wadah.addEventListener('click', event => { if (event.target === wadah) tutup(); });
    lapisan.append(bar, wadah);
    document.body.appendChild(lapisan);
    document.addEventListener('keydown', onKey);
    tombolTutup.focus();
  }

  window.MAXIFotoLihat = { buka, tutup };
})();
