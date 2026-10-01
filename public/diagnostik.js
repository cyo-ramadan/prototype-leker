(() => {
  // Halaman diagnosis untuk HP/browser yang tidak bisa login: murni di sisi
  // browser, tidak mengirim apa pun ke server selain mengambil file aplikasi dan
  // /api/menu. Nilai token TIDAK pernah ditampilkan; hanya ada/tidaknya.
  const SCRIPTS = [
    'store-context.js', 'customer-store-select.js', 'customer-login.js', 'auth-entry-split.js',
    'menu-category-filter.js', 'customer.js', 'staff-entry-guard.js', 'staff-tab-lock.js',
    'staff-auth-fetch.js', 'cashier.js', 'cashier-sales-orders.js', 'cashier-payment-methods.js'
  ];
  const STAFF_KEYS = ['lekerCashierToken', 'lekerAdminToken', 'lekerOwnerToken', 'lekerEntityAdminToken', 'lekerStaffSessionMeta', 'lekerStaffBrowserLease'];

  const errText = error => `${error?.name || 'Error'}: ${error?.message || error}`;
  const row = (label, status, detail = '') => ({ label, status, detail });

  function probeStorage(label, getStorage) {
    try {
      const storage = getStorage();
      const key = `__diag_${Date.now()}`;
      storage.setItem(key, '1');
      const readBack = storage.getItem(key);
      storage.removeItem(key);
      return readBack === '1'
        ? row(label, 'OK', 'bisa tulis dan baca')
        : row(label, 'GAGAL', 'menulis tidak error tapi nilainya tidak terbaca kembali');
    } catch (error) {
      return row(label, 'GAGAL', errText(error));
    }
  }

  function checkStorage(win) {
    const rows = [
      probeStorage('localStorage', () => win.localStorage),
      probeStorage('sessionStorage', () => win.sessionStorage)
    ];
    try {
      const doc = win.document;
      doc.cookie = '__diag=1; path=/';
      const ok = /(?:^|;\s*)__diag=1/.test(doc.cookie);
      doc.cookie = '__diag=; path=/; max-age=0';
      rows.push(row('cookie', ok ? 'OK' : 'GAGAL', ok ? 'bisa tulis dan baca' : 'cookie tidak tersimpan'));
    } catch (error) {
      rows.push(row('cookie', 'GAGAL', errText(error)));
    }
    return rows;
  }

  function staffSessionState(win) {
    const rows = [];
    let storage;
    try { storage = win.localStorage; } catch (error) { return [row('Sesi staf di browser ini', 'TIDAK TERBACA', errText(error))]; }
    for (const key of STAFF_KEYS) {
      let value = null;
      try { value = storage.getItem(key); } catch {}
      rows.push(row(key, value ? 'ADA' : 'kosong', value ? `${value.length} karakter` : ''));
    }
    try {
      const lease = JSON.parse(storage.getItem('lekerStaffBrowserLease') || 'null');
      if (lease) {
        const ageSeconds = lease.updatedAt ? Math.round((Date.now() - Number(lease.updatedAt)) / 1000) : null;
        rows.push(row('lease: peran / umur', 'INFO', `${lease.role || '-'} / ${ageSeconds == null ? '-' : `${ageSeconds} detik lalu`}`));
      }
    } catch {}
    return rows;
  }

  async function persistence(win) {
    try {
      const previous = win.localStorage.getItem('__diag_marker');
      win.localStorage.setItem('__diag_marker', String(Date.now()));
      return row(
        'Penyimpanan bertahan antar muat ulang',
        previous ? 'OK' : 'BELUM DIUJI',
        previous ? 'data dari muat sebelumnya masih ada' : 'tekan "Muat ulang" lalu lihat baris ini lagi'
      );
    } catch (error) {
      return row('Penyimpanan bertahan antar muat ulang', 'GAGAL', errText(error));
    }
  }

  async function storageQuota(win) {
    try {
      const estimate = await win.navigator.storage.estimate();
      const mb = value => `${(Number(value || 0) / 1048576).toFixed(1)} MB`;
      return row('Kuota penyimpanan situs', Number(estimate.quota) > 0 ? 'OK' : 'GAGAL', `terpakai ${mb(estimate.usage)} dari ${mb(estimate.quota)}`);
    } catch (error) {
      return row('Kuota penyimpanan situs', 'INFO', `tidak bisa dibaca (${errText(error)})`);
    }
  }

  async function checkScript(win, name) {
    try {
      const response = await win.fetch(`/${name}`, { cache: 'no-store' });
      const body = await response.text();
      const type = response.headers.get('content-type') || '';
      if (!response.ok) return row(name, 'GAGAL', `HTTP ${response.status}`);
      if (!/javascript|ecmascript/i.test(type)) return row(name, 'GAGAL', `jenis file bukan JavaScript (${type || 'kosong'}), kemungkinan dibelokkan jaringan`);
      try {
        new win.Function(body);
      } catch (error) {
        return row(name, 'GAGAL', `browser tidak bisa membaca skrip ini: ${errText(error)}`);
      }
      return row(name, 'OK', `${Math.round(body.length / 1024)} KB, terbaca`);
    } catch (error) {
      return row(name, 'GAGAL', errText(error));
    }
  }

  async function checkApi(win) {
    const started = Date.now();
    try {
      const response = await win.fetch('/api/menu?store=G001', { cache: 'no-store' });
      const body = await response.text();
      const elapsed = Date.now() - started;
      const serverDate = response.headers.get('date');
      const rows = [row('Server /api/menu', response.ok ? 'OK' : 'GAGAL', `HTTP ${response.status}, ${Math.round(body.length / 1024)} KB, ${elapsed} ms`)];
      if (serverDate) {
        const driftMinutes = Math.round((Date.now() - new Date(serverDate).getTime()) / 60000);
        rows.push(row('Jam HP vs jam server', Math.abs(driftMinutes) <= 5 ? 'OK' : 'GAGAL', `selisih ${driftMinutes} menit`));
      }
      return rows;
    } catch (error) {
      return [row('Server /api/menu', 'GAGAL', errText(error))];
    }
  }

  function deviceInfo(win) {
    const nav = win.navigator || {};
    return [
      row('Browser', 'INFO', nav.userAgent || '-'),
      row('Online / cookieEnabled', 'INFO', `${nav.onLine} / ${nav.cookieEnabled}`),
      row('crypto.randomUUID', typeof win.crypto?.randomUUID === 'function' ? 'OK' : 'TIDAK ADA', 'dipakai saat login; ada cadangan bila tidak ada'),
      row('Jam HP', 'INFO', new Date().toString())
    ];
  }

  async function runAll(win) {
    const rows = [];
    rows.push(...deviceInfo(win));
    rows.push(...checkStorage(win));
    rows.push(await persistence(win));
    rows.push(await storageQuota(win));
    rows.push(...staffSessionState(win));
    rows.push(...await checkApi(win));
    for (const name of SCRIPTS) rows.push(await checkScript(win, name));
    return rows;
  }

  const api = { checkStorage, staffSessionState, checkScript, runAll, SCRIPTS };
  window.LekerDiagnostik = api;

  const host = typeof document !== 'undefined' ? document.getElementById('hasil') : null;
  if (!host) return;
  const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  const render = rows => {
    host.innerHTML = rows.map(item => `<div class="baris ${item.status === 'GAGAL' ? 'gagal' : item.status === 'OK' ? 'ok' : ''}"><b>${esc(item.label)}</b><span>${esc(item.status)}</span><small>${esc(item.detail)}</small></div>`).join('');
    window.__diagRows = rows;
  };
  const copyButton = document.getElementById('salin');
  const reloadButton = document.getElementById('muatUlang');
  reloadButton?.addEventListener('click', () => location.reload());
  copyButton?.addEventListener('click', async () => {
    const text = (window.__diagRows || []).map(item => `${item.status} | ${item.label} | ${item.detail}`).join('\n');
    try { await navigator.clipboard.writeText(text); copyButton.textContent = 'Tersalin'; } catch { copyButton.textContent = 'Gagal menyalin, screenshot saja'; }
  });
  host.textContent = 'Memeriksa... (sekitar 10 detik)';
  runAll(window).then(render).catch(error => { host.textContent = `Diagnosis berhenti: ${errText(error)}`; });
})();
