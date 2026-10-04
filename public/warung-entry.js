// Pintu masuk Mode Warung dari Kasir lengkap -- skin D (DESAIN-SKIN-D-WARUNG.md).
// Hanya bekerja kalau tenant memilih skin D (window.MaxiSkin, public/ui-skin.js):
//  - kasir yang sudah absen & memegang laci langsung diarahkan ke /s/<kode>/warung;
//  - kalau belum (perlu absen / buka laci), Kasir lengkap tetap tampil dan ada
//    tombol "Kembali ke Mode Warung" untuk pulang setelah selesai;
//  - ?lengkap=1 (dari menu "Kasir lengkap" di Mode Warung) tidak diarahkan balik.
// Skin E (Jaga Sendiri): pemiliknya sendiri yang jaga, tidak ada absen -- kasir
// selalu diarahkan ke Mode Warung (buka/tutup warung ada di sana).
// Tenant skin 0/A/B/C tidak tersentuh sama sekali.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('readonly') === '1') return;
  const warungPath = () => (window.lekerStorePath ? window.lekerStorePath('warung') : '/warung');

  function addReturnButton() {
    if (document.getElementById('warungReturnBtn')) return;
    const link = document.createElement('a');
    link.id = 'warungReturnBtn';
    link.href = warungPath();
    link.textContent = '🏪 Kembali ke Mode Warung';
    link.style.cssText = 'position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:80;'
      + `background:${window.MaxiSkin?.skin?.() === 'e' ? '#0A5A48' : '#1446c8'};color:#fff;` + 'text-decoration:none;font-weight:800;font-size:15px;padding:13px 18px;'
      + 'border-radius:999px;box-shadow:0 10px 24px rgba(17,24,39,.25)';
    document.body.appendChild(link);
  }

  async function check() {
    const skin = window.MaxiSkin?.skin?.();
    if (skin !== 'd' && skin !== 'e') return;
    if (!localStorage.getItem('lekerCashierToken')) return;
    addReturnButton();
    if (params.get('lengkap') === '1') return;
    if (skin === 'e') { location.replace(warungPath()); return; }
    try {
      const [me, drawer] = await Promise.all([
        fetch('/api/cashier/me', { cache: 'no-store' }).then(response => (response.ok ? response.json() : null)),
        fetch('/api/cashier/drawer', { cache: 'no-store' }).then(response => (response.ok ? response.json() : null))
      ]);
      if (me?.attendanceStatus === 'in' && drawer?.canWrite) location.replace(warungPath());
    } catch {}
  }

  const start = () => Promise.resolve(window.MaxiSkin?.ready).then(check, check);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
