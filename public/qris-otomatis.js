// QRIS Otomatis (Bos Cyo, 2026-10-16) -- satu tampilan dipakai kasir dan Entity Admin.
// Pemanggil memberi fungsi api(path, options) miliknya sendiri (token kasir / Entity Admin).
// Server (src/qris-otomatis.js) yang menegakkan siapa boleh apa; tombol di sini hanya disembunyikan.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const rp = value => `Rp${Number(value || 0).toLocaleString('id-ID')}`;
  const jam = value => {
    try { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value)); }
    catch { return ''; }
  };
  const tgljam = value => {
    try { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value)); }
    catch { return value || ''; }
  };
  const MODE = { OTOMATIS: 'otomatis', CS: 'oleh CS', ADMIN: 'oleh admin' };

  let ctx = null; // { api, storeCode, tanggal, data, tab, pilihSale, setelan, tokenBaru, onClose }

  function dialog() {
    let node = document.getElementById('qrisDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'qrisDialog';
    node.className = 'info-gerai-dialog qris-dialog';
    node.addEventListener('close', () => { const done = ctx?.onClose; ctx = null; done?.(); });
    document.body.appendChild(node);
    return node;
  }

  function toast(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    if (typeof window.entityAdminToast === 'function') return window.entityAdminToast(message);
    window.alert(message);
  }

  const q = (extra = {}) => {
    const params = new URLSearchParams({ store: ctx.storeCode, ...extra });
    return `?${params}`;
  };
  const post = (path, body) => ctx.api(`/api/qris/${path}${q()}`, { method: path === 'setelan' ? 'PUT' : 'POST', body: JSON.stringify(body) });

  async function reload() {
    ctx.data = await ctx.api(`/api/qris${q(ctx.tanggal ? { tanggal: ctx.tanggal } : {})}`);
    if (ctx.tab === 'SETELAN') ctx.setelan = await ctx.api(`/api/qris/setelan${q()}`);
    if (ctx.tab === 'KOLAM') {
      try { ctx.kolamData = await ctx.api(`/api/qris/kolam${q()}`); ctx.kolamError = ''; }
      catch (error) { ctx.kolamData = null; ctx.kolamError = error.message; }
    }
    render();
  }

  function chip(kind, label) { return `<span class="status-chip ${kind}">${esc(label)}</span>`; }

  function saleRow(sale) {
    const { data } = ctx;
    let status;
    if (sale.voided) status = chip('off', 'Dibatalkan');
    else if (sale.masukId) status = chip('ok', `Tertaut ${MODE[sale.linkMode] || ''}`);
    else status = chip('warn', 'Belum tertaut');
    const bisaTaut = !sale.voided && !sale.masukId;
    let pilihan = '';
    if (bisaTaut && ctx.pilihSale === sale.id) {
      const cocok = data.pilihan.filter(item => data.canManage || item.amount === sale.amount);
      pilihan = `<div class="qris-pilihan">${cocok.length ? cocok.map(item => `
        <button class="secondary-btn" type="button" data-qr-pakai="${esc(item.id)}" data-qr-sale="${esc(sale.id)}">
          Pakai uang masuk ${jam(item.receivedAt)} · ${rp(item.amount)}${item.amount !== sale.amount ? ' (nominal beda)' : ''}
        </button>`).join('') : `<div class="muted">Belum ada uang masuk ${rp(sale.amount)} yang bisa dipakai. Kalau pembeli sudah bayar, tunggu notifikasinya masuk atau minta admin cek mutasi.</div>`}</div>`;
    }
    return `<article class="master-row qris-row">
      <div class="master-main"><strong>${rp(sale.amount)}</strong>${status}
        <div class="master-meta">${jam(sale.createdAt)} · ${esc(sale.cashierName || 'Kasir')}${sale.customerName ? ` · ${esc(sale.customerName)}` : ''}</div></div>
      ${bisaTaut ? `<button class="mini-btn" type="button" data-qr-taut="${esc(sale.id)}">${ctx.pilihSale === sale.id ? 'Tutup' : 'Tautkan'}</button>` : ''}
      ${pilihan}
    </article>`;
  }

  function masukRow(item, { tanpaGerai = false } = {}) {
    const { data } = ctx;
    let status;
    if (item.status === 'TERTAUT') status = item.saleVoided ? chip('bad', 'Penjualannya dibatalkan') : chip('ok', `Tertaut ${MODE[item.linkMode] || ''}`);
    else if (item.status === 'DIABAIKAN') status = chip('off', 'Diabaikan');
    else status = chip('bad', tanpaGerai ? 'Gerai belum dikenali' : 'Belum ada penjualan');
    const sumber = item.source === 'MANUAL' ? `Manual oleh ${esc(item.createdByName)}` : esc(item.title || item.app || 'Notifikasi HP');
    const admin = data.canManage ? [
      tanpaGerai ? `<button class="mini-btn" type="button" data-qr-pindah="${esc(item.id)}">Masukkan ke ${esc(data.store.code)}</button>` : '',
      item.status === 'TERTAUT' ? `<button class="mini-btn" type="button" data-qr-ubah="lepas" data-id="${esc(item.id)}">Lepas tautan</button>` : '',
      item.status === 'BELUM' ? `<button class="mini-btn" type="button" data-qr-ubah="abaikan" data-id="${esc(item.id)}">Abaikan</button>` : '',
      item.status === 'DIABAIKAN' ? `<button class="mini-btn" type="button" data-qr-ubah="pulihkan" data-id="${esc(item.id)}">Pulihkan</button>` : ''
    ].join('') : '';
    return `<article class="master-row qris-row">
      <div class="master-main"><strong>${rp(item.amount)}</strong>${status}
        <div class="master-meta">${tanpaGerai ? tgljam(item.receivedAt) : jam(item.receivedAt)} · ${sumber}</div>
        ${item.text ? `<div class="muted qris-teks">${esc(item.text)}</div>` : ''}
        ${item.note ? `<div class="muted qris-teks">📝 ${esc(item.note)}</div>` : ''}</div>
      ${admin}
    </article>`;
  }

  function renderHarian() {
    const { data } = ctx;
    const r = data.ringkas;
    const selisih = r.totalMasuk - r.totalPenjualan;
    const belumMetode = !data.metode.code
      ? `<div class="qris-peringatan">Cara bayar QRIS gerai ini belum dipilih, jadi penjualan QRIS belum bisa dicek.${data.canManage ? ' Buka tab Setelan.' : ' Minta admin mengaturnya.'}</div>` : '';
    return `${belumMetode}
      <div class="qris-ringkas">
        <div><b>${r.penjualanBelum}</b><span>penjualan belum tertaut</span></div>
        <div><b>${r.masukBelum}</b><span>uang masuk tanpa penjualan</span></div>
        <div><b>${rp(r.totalMasuk)}</b><span>uang masuk</span></div>
        <div><b>${rp(r.totalPenjualan)}</b><span>penjualan QRIS${selisih ? ` · uang ${selisih < 0 ? 'kurang' : 'lebih'} ${rp(Math.abs(selisih))}` : ''}</span></div>
      </div>
      ${data.canManage ? '<button class="secondary-btn" type="button" data-qr-manual>＋ Tambah uang masuk manual (dari mutasi)</button>' : ''}
      ${data.tanpaGerai?.length ? `<h3>Uang masuk yang gerainya belum dikenali</h3>${data.tanpaGerai.map(item => masukRow(item, { tanpaGerai: true })).join('')}` : ''}
      <h3>Penjualan QRIS</h3>
      ${data.sales.map(saleRow).join('') || '<div class="empty">Belum ada penjualan QRIS di tanggal ini.</div>'}
      <h3>Uang masuk (notifikasi)</h3>
      ${data.masuk.map(item => masukRow(item)).join('') || '<div class="empty">Belum ada uang QRIS masuk di tanggal ini.</div>'}`;
  }

  function renderSetelan() {
    const s = ctx.setelan;
    if (!s) return '<div class="muted">Memuat setelan…</div>';
    const token = ctx.tokenBaru;
    return `
      <div class="qris-form">
        <label>Cara bayar yang dihitung QRIS
          <select class="text-input" data-qr-metode>
            <option value="">— pilih —</option>
            ${s.paymentMethods.map(m => `<option value="${esc(m.code)}" ${m.code === s.metode.code ? 'selected' : ''}>${esc(m.name)} (${esc(m.code)})</option>`).join('')}
          </select></label>
        <label>Kata kunci gerai di teks notifikasi <span class="muted">(nama outlet, MID, atau NMID yang tertulis di notifikasi; dipakai penerima "semua gerai")</span>
          <input class="text-input" data-qr-kunci value="${esc(s.kataKunci)}" placeholder="mis. TEH POCI BENDUNGAN atau NMID ID1024311645419" /></label>
        <button class="primary-btn" type="button" data-qr-simpan>Simpan setelan</button>
      </div>
      <h3>HP penerima</h3>
      <p class="muted">HP milik pemilik yang login aplikasi merchant QRIS (Merchant BCA, GoBiz, bank, dll.) dan terpasang aplikasi <b>Penerus QRIS</b>. CS tidak perlu memasang aplikasi merchant.</p>
      ${token ? `<div class="qris-token">
        <b>Salin alamat ini sekarang. Alamat ini hanya tampil sekali:</b>
        <input class="text-input" readonly value="${esc(token.ingestUrl)}" data-qr-tokenurl />
        <button class="mini-btn" type="button" data-qr-salin>Salin</button>
        <ol class="muted">
          <li>Kirim alamat ini ke HP penerima (mis. WA ke diri sendiri) lalu salin di sana.</li>
          <li>Buka aplikasi <b>Penerus QRIS</b> → <b>Tempel</b> → <b>Simpan</b>.</li>
          <li>Di aplikasi itu pastikan "Akses notifikasi" dan "Baterai" bertanda ✅ (tekan tombolnya bila ❌).</li>
          <li>Isian "Aplikasi yang diteruskan": bawaan <code>com.bca.msb</code> (Merchant BCA); tambah paket lain bila perlu.</li>
          <li>Tekan <b>Kirim tes</b> → di daftar di bawah tertulis "Tes sambungan berhasil".</li>
        </ol>
        <p class="muted">Alternatif untuk aplikasi merchant yang notifikasinya teks biasa: MacroDroid (pemicu Notifikasi diterima → HTTP Request POST ke alamat ini, isi text/plain <code>[notification_title] [notification]</code>). Merchant BCA tidak bisa lewat MacroDroid.</p></div>` : ''}
      ${s.penerima.map(p => `<article class="master-row">
        <div class="master-main"><strong>${esc(p.label)}</strong>${chip(p.lastSeenAt ? 'ok' : 'warn', p.lastSeenAt ? `Terakhir ${tgljam(p.lastSeenAt)}` : 'Belum pernah mengirim')}
          <div class="master-meta">${p.semuaGerai ? 'Semua gerai (pakai kata kunci)' : `Gerai ${esc(p.storeCode)}`} · dibuat ${esc(p.createdByName)}</div>
          ${p.lastResult ? `<div class="muted qris-teks">${esc(p.lastResult)}</div>` : ''}</div>
        ${p.bisaCabut ? `<button class="mini-btn" type="button" data-qr-cabut="${esc(p.id)}">Cabut</button>` : ''}
      </article>`).join('') || '<div class="empty">Belum ada HP penerima.</div>'}
      <div class="qris-form">
        <input class="text-input" data-qr-label placeholder="Nama HP, mis. HP Bos (GoBiz)" />
        ${s.entityWide ? '<label class="qris-cek"><input type="checkbox" data-qr-semua /> Untuk semua gerai (gerai ditebak dari kata kunci)</label>' : ''}
        <button class="secondary-btn" type="button" data-qr-buat>＋ Buat HP penerima</button>
      </div>`;
  }

  // Kolam bersama (Bos Cyo, 2026-10-17): uang masuk yang belum punya gerai. CS yang pembelinya
  // baru membayar menekan Klaim; gerai lain lalu terkunci. Tidak ada bunyi -- CS yang bersangkutan
  // memang sedang menunggu pembayaran pembelinya.
  function renderKolam() {
    if (ctx.kolamError) return `<div class="qris-peringatan">${esc(ctx.kolamError)}</div>`;
    const data = ctx.kolamData;
    if (!data) return '<div class="muted">Memuat kolam…</div>';
    const code = esc(data.store.code);
    const baris = item => {
      let status;
      let tombol = '';
      if (!item.diklaim) {
        status = chip('bad', 'Belum diklaim');
        tombol = `<button class="primary-btn" type="button" data-qr-klaim="${esc(item.id)}">✋ Klaim untuk ${code}</button>`;
      } else if (item.milikGeraiIni) {
        status = chip('ok', `Diklaim ${item.storeCode}${item.claimedByName ? ` · ${item.claimedByName}` : ''}`)
          + (item.status === 'TERTAUT' ? ` ${chip('ok', 'Tertaut')}` : ` ${chip('warn', 'Belum ditautkan')}`);
      } else {
        status = chip('off', `Diklaim ${item.storeCode || 'gerai lain'}`);
      }
      if (item.bisaBatal) tombol += `<button class="mini-btn" type="button" data-qr-batal="${esc(item.id)}">Batal klaim</button>`;
      return `<article class="master-row qris-row${item.diklaim && !item.milikGeraiIni ? ' qris-row-lain' : ''}">
        <div class="master-main"><strong>${rp(item.amount)}</strong>${status}
          <div class="master-meta">${jam(item.receivedAt)}${item.sumberBayar ? ` · dari ${esc(item.sumberBayar)}` : ''}</div></div>
        ${tombol}
      </article>`;
    };
    return `<p class="muted">Begitu pembelimu membayar QRIS, cari nominal &amp; jamnya di sini lalu tekan <b>Klaim</b>. Yang sudah diklaim gerai lain terkunci. Menautkan ke penjualan boleh nanti di tab "Hari ini".</p>
      ${data.items.map(baris).join('') || '<div class="empty">Belum ada uang QRIS masuk dalam 24 jam terakhir.</div>'}`;
  }

  function render() {
    if (!ctx) return;
    const node = dialog();
    const { data } = ctx;
    const tab = (id, label) => `<button class="info-gerai-tab ${ctx.tab === id ? 'active' : ''}" type="button" data-qr-tab="${id}">${label}</button>`;
    node.innerHTML = `
      <div class="info-gerai-head">
        <div><h2>📲 QRIS</h2><div class="muted">${esc(data.store.code)} · ${esc(data.store.name || '')}</div></div>
        <button class="secondary-btn" type="button" data-qr-tutup>Tutup</button>
      </div>
      <div class="info-gerai-tabs">
        ${ctx.kolam ? tab('KOLAM', '🧾 Kolam QRIS') : ''}${tab('HARIAN', 'Hari ini')}${data.canManage ? tab('SETELAN', '⚙️ Setelan') : ''}
        ${ctx.tab === 'HARIAN' ? `<input class="text-input qris-tanggal" type="date" value="${esc(data.tanggal)}" data-qr-tanggal />` : ''}
        <button class="mini-btn" type="button" data-qr-muat>Muat ulang</button>
      </div>
      <div class="qris-isi">${ctx.tab === 'SETELAN' ? renderSetelan() : ctx.tab === 'KOLAM' ? renderKolam() : renderHarian()}</div>`;
    bind(node);
  }

  async function aksi(fn, button) {
    if (button) button.disabled = true;
    try { await fn(); await reload(); }
    catch (error) { toast(error.message); if (button) button.disabled = false; }
  }

  function bind(node) {
    const on = (selector, handler) => node.querySelectorAll(selector).forEach(el => { el.onclick = () => handler(el); });
    on('[data-qr-tutup]', () => node.close());
    on('[data-qr-muat]', button => aksi(async () => {}, button));
    on('[data-qr-tab]', button => { ctx.tab = button.dataset.qrTab; ctx.tokenBaru = null; aksi(async () => {}); });
    const tanggal = node.querySelector('[data-qr-tanggal]');
    if (tanggal) tanggal.onchange = () => { ctx.tanggal = tanggal.value; aksi(async () => {}); };
    on('[data-qr-klaim]', button => aksi(async () => {
      const hasil = await post('klaim', { masukId: button.dataset.qrKlaim });
      toast(hasil.tertaut ? 'Diklaim & langsung tertaut ✓' : 'Diklaim ✓ — tautkan nanti di tab "Hari ini"');
    }, button));
    on('[data-qr-batal]', button => aksi(async () => {
      let catatan = '';
      if (ctx.data.canManage) {
        catatan = window.prompt('Alasan membatalkan klaim ini:') || '';
        if (!catatan.trim()) throw new Error('Dibatalkan: alasan wajib diisi.');
      } else if (!window.confirm('Batalkan klaim? Uang ini kembali ke kolam dan bisa diklaim gerai lain.')) throw new Error('Dibatalkan.');
      await post('batal-klaim', { masukId: button.dataset.qrBatal, catatan });
      toast('Klaim dibatalkan');
    }, button));
    on('[data-qr-taut]', button => { ctx.pilihSale = ctx.pilihSale === button.dataset.qrTaut ? null : button.dataset.qrTaut; render(); });
    on('[data-qr-pakai]', button => aksi(async () => {
      const masuk = ctx.data.pilihan.find(item => item.id === button.dataset.qrPakai);
      const sale = ctx.data.sales.find(item => item.id === button.dataset.qrSale);
      let catatan = '';
      if (masuk && sale && masuk.amount !== sale.amount) {
        catatan = window.prompt(`Nominal beda (${rp(sale.amount)} vs ${rp(masuk.amount)}). Tulis alasannya:`) || '';
        if (!catatan.trim()) throw new Error('Dibatalkan: alasan wajib diisi.');
      }
      await post('tautkan', { masukId: button.dataset.qrPakai, saleId: button.dataset.qrSale, catatan });
      ctx.pilihSale = null;
      toast('Tertaut ✓');
    }, button));
    on('[data-qr-ubah]', button => aksi(async () => {
      const label = { lepas: 'melepas tautan', abaikan: 'mengabaikan uang masuk ini', pulihkan: 'memulihkan' }[button.dataset.qrUbah];
      const catatan = window.prompt(`Alasan ${label}:`);
      if (!catatan?.trim()) throw new Error('Dibatalkan: alasan wajib diisi.');
      await post(button.dataset.qrUbah, { masukId: button.dataset.id, catatan });
    }, button));
    on('[data-qr-pindah]', button => aksi(async () => {
      const catatan = window.prompt(`Masukkan uang ini ke gerai ${ctx.data.store.code}? Tulis alasannya:`);
      if (!catatan?.trim()) throw new Error('Dibatalkan: alasan wajib diisi.');
      await post('pindah-gerai', { masukId: button.dataset.qrPindah, storeCode: ctx.data.store.code, catatan });
    }, button));
    on('[data-qr-manual]', button => aksi(async () => {
      const amount = Number(String(window.prompt('Nominal uang masuk (Rp):') || '').replace(/\D/g, ''));
      if (!amount) throw new Error('Dibatalkan.');
      const catatan = window.prompt('Sumber/bukti (mis. dicek di mutasi BRI jam 14:05):');
      if (!catatan?.trim()) throw new Error('Dibatalkan: catatan wajib diisi.');
      await post('manual', { amount, catatan });
    }, button));
    on('[data-qr-simpan]', button => aksi(async () => {
      await post('setelan', { paymentMethodCode: node.querySelector('[data-qr-metode]').value, kataKunci: node.querySelector('[data-qr-kunci]').value });
      toast('Setelan QRIS tersimpan');
    }, button));
    on('[data-qr-buat]', button => aksi(async () => {
      ctx.tokenBaru = await post('penerima', { label: node.querySelector('[data-qr-label]').value, semuaGerai: Boolean(node.querySelector('[data-qr-semua]')?.checked) });
    }, button));
    on('[data-qr-cabut]', button => aksi(async () => {
      if (!window.confirm('Cabut HP penerima ini? Notifikasinya tidak akan diterima lagi.')) throw new Error('Dibatalkan.');
      await post('penerima/cabut', { id: button.dataset.qrCabut });
    }, button));
    on('[data-qr-salin]', () => {
      const input = node.querySelector('[data-qr-tokenurl]');
      navigator.clipboard?.writeText(input.value).then(() => toast('Alamat disalin'), () => { input.select(); });
    });
  }

  async function open({ api, storeCode, onClose = null, tab, kolam = false }) {
    ctx = { api, storeCode, tanggal: '', data: null, tab: tab || (kolam ? 'KOLAM' : 'HARIAN'), kolam, kolamData: null, kolamError: '', pilihSale: null, setelan: null, tokenBaru: null, onClose };
    const node = dialog();
    node.innerHTML = '<div class="muted">Memuat QRIS…</div>';
    if (!node.open) node.showModal();
    try { await reload(); }
    catch (error) {
      node.innerHTML = `<div class="info-gerai-head"><div>${esc(error.message)}</div><button class="secondary-btn" type="button" data-qr-tutup>Tutup</button></div>`;
      node.querySelector('[data-qr-tutup]').onclick = () => node.close();
    }
  }

  // Dimuat saat halaman dibuka/fokus/ada notifikasi (bukan polling).
  async function ringkasan(api, storeCode) {
    try { return await api(`/api/qris/ringkasan?store=${encodeURIComponent(storeCode)}`); }
    catch { return { enabled: false, stores: [], tanpaGerai: 0 }; }
  }

  const isOpen = () => Boolean(ctx && document.getElementById('qrisDialog')?.open);
  async function refreshIfOpen() { if (isOpen()) { try { await reload(); } catch {} } }

  window.QrisOtomatis = { open, ringkasan, refreshIfOpen };
})();
