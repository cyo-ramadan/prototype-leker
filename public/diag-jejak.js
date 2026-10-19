// Jejak untuk /diagnostik (Bos Cyo, 2026-10-19). Dimuat paling awal di halaman kasir: mencatat
// error JavaScript terakhir dan versi skrip yang BENAR-BENAR dimuat HP ini, supaya halaman
// /diagnostik bisa membedakan "HP memakai halaman kasir lama" dari "skrip gagal/terblokir"
// (mis. tombol Kolam QRIS tidak muncul). Hanya nama file, versi, dan pesan error -- tanpa data akun.
(() => {
  const KEY = 'lekerDiagJejak';
  const WATCH = ['cashier-data-explorer.js', 'qris-otomatis.js', 'qris-kasir.js', 'cashier.js', 'cashier-payment-methods.js'];
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
  const write = data => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  const pageAt = Date.now();
  const data = read();
  data.errors = (Array.isArray(data.errors) ? data.errors : []).filter(item => pageAt - Number(item.at || 0) < 3 * 86400000);
  const addError = (message, source) => {
    data.errors.push({ at: Date.now(), page: location.pathname, message: String(message || '').slice(0, 300), source: String(source || '').slice(0, 200) });
    data.errors = data.errors.slice(-10);
    write(data);
  };
  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target !== window && (target.src || target.href)) addError('gagal memuat file', target.src || target.href);
    else addError(event.message, `${event.filename || ''}:${event.lineno || ''}`);
  }, true);
  window.addEventListener('unhandledrejection', event => addError(`promise: ${event.reason?.message || event.reason}`, ''));
  window.addEventListener('load', () => {
    const versions = {};
    for (const script of document.scripts) {
      const match = /\/([\w.-]+\.js)(?:\?v=([^&]+))?/.exec(script.getAttribute('src') || '');
      if (match && WATCH.includes(match[1])) versions[match[1]] = match[2] || '-';
    }
    data.kasir = {
      at: pageAt,
      page: location.pathname,
      versions,
      qrisOtomatis: Boolean(window.QrisOtomatis),
      online: navigator.onLine,
      jaringan: navigator.connection ? `${navigator.connection.effectiveType || '-'} / ${navigator.connection.type || '-'}` : '-'
    };
    write(data);
  });
})();
