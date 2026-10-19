(() => {
  // Halaman diagnosis untuk HP/browser yang bermasalah. Hasil (tanpa nilai token,
  // hanya ada/tidaknya) dikirim otomatis ke /api/diagnostik/laporan supaya agen
  // programmer bisa menganalisis dan membetulkannya di program, bukan di setelan HP.
  const SCRIPTS = [
    'store-context.js', 'customer-store-select.js', 'customer-login.js', 'auth-entry-split.js',
    'menu-category-filter.js', 'customer.js', 'staff-entry-guard.js', 'staff-tab-lock.js',
    'staff-auth-fetch.js', 'cashier.js', 'cashier-sales-orders.js', 'cashier-payment-methods.js',
    'diag-jejak.js', 'cashier-data-explorer.js', 'qris-otomatis.js', 'qris-kasir.js'
  ];
  // Versi skrip kasir yang dibandingkan dengan jejak HP (public/diag-jejak.js).
  const KASIR_WATCH = ['cashier-data-explorer.js', 'qris-otomatis.js', 'qris-kasir.js', 'cashier.js', 'cashier-payment-methods.js'];
  // Domain aplikasi + font: bila salah satu tak terjangkau dari jaringan ini (DNS operator
  // memblokir/lambat), terlihat di sini tanpa membuka setelan HP.
  const HOSTS = ['https://prototype-leker-v2.daily-napkin.workers.dev', 'https://ownertenang.biz.id', 'https://fonts.googleapis.com'];
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

  function readJejak(win) {
    try { return JSON.parse(win.localStorage.getItem('lekerDiagJejak') || 'null') || {}; } catch { return {}; }
  }

  function scriptVersions(html) {
    const versions = {};
    const pattern = /<script[^>]+src="\/([\w.-]+\.js)(?:\?v=([^"&]+))?/g;
    let match;
    while ((match = pattern.exec(html))) if (KASIR_WATCH.includes(match[1])) versions[match[1]] = match[2] || '-';
    return versions;
  }

  // Bandingkan skrip yang terakhir dimuat halaman kasir di HP ini dengan versi terbaru server.
  function compareKasir(jejak, latest, now = Date.now()) {
    const rows = [];
    const kasir = jejak?.kasir;
    if (!kasir) {
      rows.push(row('Halaman kasir di HP ini', 'INFO', 'belum ada catatan: buka halaman kasir sekali, lalu buka /diagnostik lagi'));
    } else {
      const ageMinutes = Math.round((now - Number(kasir.at || 0)) / 60000);
      rows.push(row('Halaman kasir terakhir dibuka', 'INFO', `${ageMinutes} menit lalu (${kasir.page || '-'}), jaringan ${kasir.jaringan || '-'}`));
      const stale = KASIR_WATCH.filter(name => latest[name] && kasir.versions?.[name] && kasir.versions[name] !== latest[name]);
      rows.push(stale.length
        ? row('Versi halaman kasir', 'GAGAL', `HP memakai versi lama: ${stale.map(name => `${name} ${kasir.versions[name]} (terbaru ${latest[name]})`).join('; ')}. Tekan "Bersihkan & buka kasir".`)
        : row('Versi halaman kasir', 'OK', 'sama dengan versi terbaru'));
      rows.push(kasir.qrisOtomatis
        ? row('Modul QRIS (Kolam QRIS)', 'OK', 'termuat di halaman kasir')
        : row('Modul QRIS (Kolam QRIS)', 'GAGAL', 'tidak termuat di halaman kasir terakhir, tombol Kolam QRIS tidak akan bekerja'));
    }
    const errors = Array.isArray(jejak?.errors) ? jejak.errors.slice(-5) : [];
    if (!errors.length) rows.push(row('Error JavaScript di kasir (3 hari)', 'OK', 'tidak ada'));
    for (const item of errors) {
      const ageMinutes = Math.round((now - Number(item.at || 0)) / 60000);
      rows.push(row('Error JavaScript di kasir', 'GAGAL', `${ageMinutes} menit lalu: ${item.message} ${item.source || ''}`.trim()));
    }
    return rows;
  }

  async function checkKasir(win) {
    let latest;
    try {
      const response = await win.fetch('/cashier', { cache: 'no-store' });
      latest = scriptVersions(await response.text());
    } catch (error) {
      return [row('Halaman kasir terbaru', 'GAGAL', errText(error))];
    }
    return compareKasir(readJejak(win), latest);
  }

  async function checkHosts(win) {
    const rows = [];
    for (const host of HOSTS) {
      const label = `Jangkau ${host.replace('https://', '')}`;
      const started = Date.now();
      try {
        const controller = typeof win.AbortController === 'function' ? new win.AbortController() : null;
        const timer = controller ? win.setTimeout(() => controller.abort(), 8000) : null;
        await win.fetch(`${host}/favicon.ico?diag=${started}`, { mode: 'no-cors', cache: 'no-store', signal: controller?.signal });
        if (timer) win.clearTimeout(timer);
        const elapsed = Date.now() - started;
        rows.push(elapsed > 4000
          ? row(label, 'GAGAL', `${elapsed} ms, sangat lambat (kemungkinan DNS operator)`)
          : row(label, 'OK', `${elapsed} ms`));
      } catch (error) {
        rows.push(row(label, 'GAGAL', `${errText(error)} setelah ${Date.now() - started} ms, kemungkinan diblokir/DNS operator`));
      }
    }
    return rows;
  }

  function networkInfo(win) {
    const connection = win.navigator?.connection;
    return [row('Jenis koneksi (menurut browser)', 'INFO', connection
      ? `${connection.effectiveType || '-'} / ${connection.type || '-'} / downlink ${connection.downlink ?? '-'} Mbps / rtt ${connection.rtt ?? '-'} ms`
      : 'tidak tersedia di browser ini')];
  }

  // Kirim hasil ke server (src/diagnostik-laporan.js); agen membaca tabel diagnostik_laporan.
  async function sendReport(win, rows, catatan = '') {
    const headers = { 'content-type': 'application/json' };
    try {
      const token = win.localStorage.getItem('lekerCashierToken');
      if (token) headers.authorization = `Bearer ${token}`;
    } catch {}
    const response = await win.fetch('/api/diagnostik/laporan', { method: 'POST', headers, body: JSON.stringify({ rows, catatan }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function cleanAndOpenKasir(win) {
    try { for (const key of await win.caches.keys()) await win.caches.delete(key); } catch {}
    win.location.href = `/cashier?segarkan=${Date.now()}`;
  }

  async function runAll(win) {
    const rows = [];
    rows.push(...deviceInfo(win));
    rows.push(...networkInfo(win));
    rows.push(...checkStorage(win));
    rows.push(await persistence(win));
    rows.push(await storageQuota(win));
    rows.push(...staffSessionState(win));
    rows.push(...await checkApi(win));
    rows.push(...await checkKasir(win));
    rows.push(...await checkHosts(win));
    for (const name of SCRIPTS) rows.push(await checkScript(win, name));
    return rows;
  }

  const api = { checkStorage, staffSessionState, checkScript, runAll, SCRIPTS, scriptVersions, compareKasir, sendReport };
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
  const sendButton = document.getElementById('kirim');
  const cleanButton = document.getElementById('bersihkan');
  const status = document.getElementById('kirimStatus');
  const note = document.getElementById('catatan');
  reloadButton?.addEventListener('click', () => location.reload());
  cleanButton?.addEventListener('click', () => cleanAndOpenKasir(window));
  copyButton?.addEventListener('click', async () => {
    const text = (window.__diagRows || []).map(item => `${item.status} | ${item.label} | ${item.detail}`).join('\n');
    try { await navigator.clipboard.writeText(text); copyButton.textContent = 'Tersalin'; } catch { copyButton.textContent = 'Gagal menyalin, screenshot saja'; }
  });
  const send = async () => {
    if (!window.__diagRows) return;
    if (status) status.textContent = 'Mengirim hasil ke tim MAXI...';
    try {
      const result = await sendReport(window, window.__diagRows, note?.value || '');
      if (status) status.innerHTML = `Terkirim. Kode laporan: <b>${esc(result.kode)}</b>, sebutkan kode ini ke admin.${result.jaringan?.isp ? ` Jaringan: ${esc(result.jaringan.isp)}.` : ''}`;
    } catch (error) {
      if (status) status.textContent = `Gagal mengirim (${errText(error)}). Tekan "Salin hasil" lalu kirim lewat WA.`;
    }
  };
  sendButton?.addEventListener('click', send);
  host.textContent = 'Memeriksa... (sekitar 10-20 detik)';
  runAll(window).then(rows => { render(rows); return send(); }).catch(error => { host.textContent = `Diagnosis berhenti: ${errText(error)}`; });
})();
