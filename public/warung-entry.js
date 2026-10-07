// Pintu masuk Mode Warung dari Kasir lengkap -- skin D (DESAIN-SKIN-D-WARUNG.md).
// Hanya bekerja kalau tenant memilih skin D (window.MaxiSkin, public/ui-skin.js):
//  - kasir yang sudah absen & memegang laci langsung diarahkan ke /s/<kode>/warung;
//  - kalau belum (perlu absen / buka laci), Kasir lengkap tetap tampil dan ada
//    tombol "Kembali ke Mode Warung" untuk pulang setelah selesai;
//  - ?lengkap=1 (dari menu "Kasir lengkap" di Mode Warung) tidak diarahkan balik.
// Skin E (Jaga Sendiri): pemiliknya sendiri yang jaga, tidak ada absen -- kasir
// selalu diarahkan ke Mode Warung (buka/tutup warung ada di sana).
// Skin F (Racik Parfum, DESAIN-SKIN-F-RACIK-PARFUM.md): sama seperti D, tapi
// tujuannya layar Racik (/s/<kode>/racik).
// Tenant skin 0/A/B/C tidak tersentuh sama sekali.
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('readonly') === '1') return;
  const homePage = () => (window.MaxiSkin?.skin?.() === 'f' ? 'racik' : 'warung');
  const warungPath = () => (window.lekerStorePath ? window.lekerStorePath(homePage()) : `/${homePage()}`);

  function addReturnButton() {
    if (document.getElementById('warungReturnBtn')) return;
    const link = document.createElement('a');
    link.id = 'warungReturnBtn';
    link.href = warungPath();
    link.textContent = homePage() === 'racik' ? '⚗ Kembali ke Racik' : '🏪 Kembali ke Mode Warung';
    link.style.cssText = 'position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:80;'
      + `background:${({ e: '#0A5A48', f: '#4A1A42' })[window.MaxiSkin?.skin?.()] || '#1446c8'};color:#fff;` + 'text-decoration:none;font-weight:800;font-size:15px;padding:13px 18px;'
      + 'border-radius:999px;box-shadow:0 10px 24px rgba(17,24,39,.25)';
    document.body.appendChild(link);
  }

  // Skin F: tombol "Beli bahan" / "Biaya operasional" di Panel Pemilik membuka
  // Kasir lengkap dengan ?aksi=beli|biaya -- tekan tombol aslinya begitu siap
  // (tombol Pengeluaran baru aktif setelah laci terbaca). Tanpa polling:
  // menunggu perubahan DOM, berhenti sendiri setelah 20 detik.
  function openRequestedAction() {
    const id = { beli: 'purchaseBtn', biaya: 'expenseBtn' }[params.get('aksi')];
    if (!id) return;
    const tryClick = () => {
      const button = document.getElementById(id);
      // Tombol Pengeluaran baru aktif setelah laci terbaca -- tanda halaman
      // siap. Beli Bahan selalu aktif, jadi ikut menunggu tanda yang sama.
      const ready = document.getElementById('expenseBtn');
      if (!button || button.disabled || button.offsetParent === null || !ready || ready.disabled) return false;
      button.click();
      return true;
    };
    if (tryClick()) return;
    const observer = new MutationObserver(() => { if (tryClick()) observer.disconnect(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'class', 'hidden', 'style'] });
    setTimeout(() => observer.disconnect(), 20000);
  }

  async function check() {
    const skin = window.MaxiSkin?.skin?.();
    if (skin !== 'd' && skin !== 'e' && skin !== 'f') return;
    if (!localStorage.getItem('lekerCashierToken')) return;
    addReturnButton();
    if (params.get('lengkap') === '1') { openRequestedAction(); return; }
    // Skin F (Bos Cyo 2026-10-06): tanpa absen, laci dibuka langsung di layar Racik.
    if (skin === 'e' || skin === 'f') { location.replace(warungPath()); return; }
    try {
      const [me, drawer] = await Promise.all([
        fetch('/api/cashier/me', { cache: 'no-store' }).then(response => (response.ok ? response.json() : null)),
        fetch('/api/cashier/drawer', { cache: 'no-store' }).then(response => (response.ok ? response.json() : null))
      ]);
      if (me?.attendanceStatus === 'in' && drawer?.canWrite) location.replace(warungPath());
    } catch {}
  }

  // Skin yang diganti Owner SAAT Kasir terbuka (ui-skin.js mengecek ulang tiap tab kembali aktif)
  // juga harus langsung berlaku: pindah ke Warung/Racik, atau tombol pulangnya hilang.
  function onSkinChange() {
    // Skin diganti Owner ke yang bukan Warung/Racik: tombol pulangnya ikut hilang.
    if (!['d', 'e', 'f'].includes(window.MaxiSkin?.skin?.())) document.getElementById('warungReturnBtn')?.remove();
    return check();
  }
  const start = () => Promise.resolve(window.MaxiSkin?.ready).then(check, check)
    .then(() => window.addEventListener('maxi-skin-change', onSkinChange));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
