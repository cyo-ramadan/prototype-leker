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
    if (ctx.tab === 'KOLAM') {
      const view = ctx;
      try {
        const data = await view.api(`/api/qris/kolam${q({ klaim: view.klaim })}`);
        if (ctx !== view) return;
        view.kolamData = data;
        view.data = data;
        view.kolamError = '';
      } catch (error) {
        if (ctx !== view) return;
        view.kolamData = null;
        view.kolamError = error.message;
        view.data ||= { store: { code: view.storeCode } };
      }
      render();
      return;
    }
    ctx.data = await ctx.api(`/api/qris${q(ctx.tanggal ? { tanggal: ctx.tanggal } : {})}`);
    if (ctx.tab === 'SETELAN') ctx.setelan = await ctx.api(`/api/qris/setelan${q()}`);
    if (ctx.tab === 'MUTASI') {
      try { ctx.mutasi = await ctx.api(`/api/qris/mutasi${q(ctx.mutasiTanggal ? { tanggal: ctx.mutasiTanggal } : {})}`); ctx.mutasiError = ''; }
      catch (error) { ctx.mutasi = null; ctx.mutasiError = error.message; }
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
    const filter = `<label class="field">Status klaim<select class="text-input" data-qr-klaim-filter aria-label="Status klaim">${[['SEMUA', 'Semua'], ['BELUM', 'Belum diklaim'], ['SUDAH', 'Sudah diklaim']].map(([value, label]) => `<option value="${value}" ${ctx.klaim === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
    if (ctx.kolamError) return `${filter}<div class="qris-peringatan">${esc(ctx.kolamError)}</div>`;
    const data = ctx.kolamData;
    if (!data) return `${filter}<div class="muted">Memuat kolam…</div>`;
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
    const kosong = ctx.klaim === 'BELUM' ? 'Belum ada uang QRIS yang belum diklaim dalam 24 jam terakhir.' : ctx.klaim === 'SUDAH' ? 'Belum ada uang QRIS yang sudah diklaim dalam 24 jam terakhir.' : 'Belum ada uang QRIS masuk dalam 24 jam terakhir.';
    return `${filter}<p class="muted">Begitu pembelimu membayar QRIS, cari nominal &amp; jamnya di sini lalu tekan <b>Klaim</b>. Yang sudah diklaim gerai lain terkunci. Menautkan ke penjualan boleh nanti di tab "Hari ini".</p>
      ${data.items.map(baris).join('') || `<div class="empty">${kosong}</div>`}`;
  }

  // ---- Validasi mutasi BCA (Bos Cyo, 2026-10-18; src/qris-mutasi.js) ------------------------------
  // Mutasi Merchant BCA diekspor H+1. File Excel terkuncinya dibuka di perangkat ini (bca-mutasi-baca.js);
  // yang dikirim ke server hanya baris transaksinya.
  const STATUS_MUTASI = {
    COCOK: ['ok', 'Cocok'], BELUM_DITAUTKAN: ['warn', 'Gerai benar, belum ditautkan'], BELUM_DIKLAIM: ['warn', 'Belum diklaim'],
    SALAH_GERAI: ['bad', 'Salah gerai'], TANPA_NOTIF: ['bad', 'Notifikasi tidak sampai'], BELUM_DIPETAKAN: ['off', 'Outlet belum dipasangkan']
  };
  const URUT_MUTASI = ['SALAH_GERAI', 'TANPA_NOTIF', 'BELUM_DIKLAIM', 'BELUM_DIPETAKAN', 'BELUM_DITAUTKAN', 'COCOK'];

  function tebakGeraiOutlet(nama, gerai) {
    const atas = String(nama || '').toUpperCase();
    const kena = gerai.filter(g => atas.includes(String(g.code).toUpperCase()) || (g.name && atas.includes(String(g.name).toUpperCase())));
    return kena.length === 1 ? kena[0].code : '';
  }

  function renderMutasi() {
    let sandiTersimpan = '';
    try { sandiTersimpan = localStorage.getItem('qrisMutasiSandi') || ''; } catch {}
    const unggah = `<div class="qris-form">
        <label>File mutasi Merchant BCA (.xlsx, ekspor "Transaction Report")
          <input class="text-input" type="file" accept=".xlsx" data-mt-file /></label>
        <label>Kata sandi file dari BCA
          <input class="text-input" type="password" autocomplete="off" value="${esc(sandiTersimpan)}" data-mt-sandi /></label>
        <label class="qris-cek"><input type="checkbox" data-mt-ingat ${sandiTersimpan ? 'checked' : ''} /> Ingat kata sandi di perangkat ini</label>
        <button class="primary-btn" type="button" data-mt-baca>Baca & cocokkan</button>
        <p class="muted">Mutasi bisa diunggah H+1 (paling akhir kemarin). File dibuka di perangkat ini; yang dikirim hanya baris transaksinya. Unggah ulang file yang sama aman (tidak dobel).</p>
      </div>`;
    if (ctx.mutasiError) return `${unggah}<div class="qris-peringatan">${esc(ctx.mutasiError)}</div>`;
    const d = ctx.mutasi;
    if (!d) return `${unggah}<div class="muted">Memuat…</div>`;
    if (!d.tersedia.length) return `${unggah}<div class="empty">Belum ada mutasi yang diunggah.</div>`;
    const r = d.ringkas;
    const pilihTanggal = `<label>Tanggal mutasi <select class="text-input" data-mt-tanggal>${d.tersedia.map(t => `<option value="${esc(t.tanggal)}" ${t.tanggal === d.tanggal ? 'selected' : ''}>${esc(t.tanggal)} (${t.jumlah})</option>`).join('')}</select></label>`;
    const kotak = (n, label, kind) => `<div><b class="${n && kind === 'bad' ? 'qris-angka-bad' : ''}">${n}</b><span>${label}</span></div>`;
    const ringkas = `<div class="qris-ringkas">
        <div><b>${rp(r.totalRupiah)}</b><span>${r.total} transaksi di mutasi</span></div>
        ${kotak(r.cocok, 'cocok', 'ok')}${kotak(r.salahGerai, 'salah gerai', 'bad')}${kotak(r.tanpaNotif, 'notifikasi tidak sampai', 'bad')}
        ${kotak(r.belumDiklaim, 'belum diklaim', 'warn')}${kotak(r.belumDitautkan, 'gerai benar, belum ditautkan', 'warn')}
        ${kotak(r.notifTanpaMutasi, 'uang masuk tanpa mutasi', 'bad')}${kotak(r.belumDipetakan, 'outlet belum dipasangkan', 'off')}
      </div>`;
    const peta = `<h3>Outlet BCA → gerai</h3>
      ${d.peta.map(p => {
        const pilih = p.storeCode || tebakGeraiOutlet(p.merchantName, d.gerai);
        return `<div class="qris-pilih-row"><div><strong>${esc(p.merchantName || '-')}</strong><div class="muted">MID ${esc(p.mid)}${p.storeCode ? '' : ' · belum dipasangkan'}</div></div>
          <div style="display:flex;gap:6px"><select class="text-input" data-mt-peta="${esc(p.mid)}"><option value="">— pilih gerai —</option>${d.gerai.map(g => `<option value="${esc(g.code)}" ${g.code === pilih ? 'selected' : ''}>${esc(g.code)}</option>`).join('')}</select>
          <button class="mini-btn" type="button" data-mt-peta-simpan="${esc(p.mid)}">${p.storeCode ? 'Ubah' : 'Simpan'}</button></div></div>`;
      }).join('')}`;
    const urut = [...d.baris].sort((a, b) => URUT_MUTASI.indexOf(a.status) - URUT_MUTASI.indexOf(b.status) || a.trxAt.localeCompare(b.trxAt));
    const daftar = `<h3>Transaksi di mutasi</h3>${urut.map(row => {
      const [kind, label] = STATUS_MUTASI[row.status] || ['off', row.status];
      const info = row.masuk
        ? `Uang masuk ${jam(row.masuk.receivedAt)} · ${row.masuk.storeCode ? `diklaim ${esc(row.masuk.storeCode)}${row.masuk.claimedByName ? ` (${esc(row.masuk.claimedByName)})` : ''}` : 'di kolam'}${row.masuk.saleId ? ' · tertaut penjualan' : ''}`
        : 'Tidak ada uang masuk yang cocok';
      const aksi = row.status === 'SALAH_GERAI' ? `<button class="mini-btn" type="button" data-mt-pindah="${esc(row.id)}">Pindahkan ke ${esc(row.geraiSeharusnya)}</button>`
        : row.status === 'TANPA_NOTIF' ? `<button class="mini-btn" type="button" data-mt-buat="${esc(row.id)}">Buat uang masuk di ${esc(row.geraiSeharusnya)}</button>` : '';
      return `<article class="master-row qris-row"><div class="master-main"><strong>${rp(row.amount)}</strong>${chip(kind, label)}
          <div class="master-meta">${jam(row.trxAt)} · ${esc(row.merchantName)}${row.geraiSeharusnya ? ` (${esc(row.geraiSeharusnya)})` : ''} · dari ${esc(row.paymentType || '-')}</div>
          <div class="muted qris-teks">${info} · RRN ${esc(row.rrn)}</div></div>${aksi}</article>`;
    }).join('')}`;
    const tanpaMutasi = d.notifTanpaMutasi.length ? `<h3>Uang masuk tanpa baris mutasi</h3><p class="muted">Tercatat dari notifikasi, tapi tidak ada di mutasi tanggal ini: periksa (notifikasi palsu, dobel, atau transaksi lewat tengah malam).</p>
      ${d.notifTanpaMutasi.map(item => `<article class="master-row qris-row"><div class="master-main"><strong>${rp(item.amount)}</strong>${chip('bad', item.storeCode ? `Diklaim ${item.storeCode}` : 'Di kolam')}
        <div class="master-meta">${jam(item.receivedAt)}${item.sumberBayar ? ` · dari ${esc(item.sumberBayar)}` : ''}${item.claimedByName ? ` · ${esc(item.claimedByName)}` : ''}</div></div></article>`).join('')}` : '';
    return `${unggah}${pilihTanggal}${ringkas}${peta}${daftar}${tanpaMutasi}`;
  }

  async function bacaUnggahMutasi(node, button) {
    const file = node.querySelector('[data-mt-file]')?.files?.[0];
    if (!file) throw new Error('Pilih file Excel mutasi dulu.');
    if (!window.BcaMutasi) throw new Error('Pembaca mutasi belum termuat. Muat ulang halaman.');
    const sandi = node.querySelector('[data-mt-sandi]').value;
    try {
      if (node.querySelector('[data-mt-ingat]')?.checked) localStorage.setItem('qrisMutasiSandi', sandi);
      else localStorage.removeItem('qrisMutasiSandi');
    } catch {}
    const semula = button.textContent;
    let hasil;
    let res;
    try {
      button.textContent = 'Membuka file…';
      hasil = await window.BcaMutasi.baca(await file.arrayBuffer(), sandi);
      button.textContent = `Mengirim ${hasil.rows.length} baris…`;
      res = await post('mutasi', { fileName: file.name, rows: hasil.rows });
    } finally {
      button.textContent = semula;
    }
    ctx.mutasiTanggal = res.tanggal.at(-1);
    toast(`Mutasi ${res.tanggal.join(', ')}: ${res.baru} baris baru${res.dobel ? `, ${res.dobel} sudah pernah diunggah` : ''}`);
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
        ${ctx.kolam ? tab('KOLAM', '🧾 Kolam QRIS') : ''}${tab('HARIAN', 'Hari ini')}${data.canManage ? tab('SETELAN', '⚙️ Setelan') : ''}${data.entityWide ? tab('MUTASI', '🏦 Mutasi BCA') : ''}
        ${ctx.tab === 'HARIAN' ? `<input class="text-input qris-tanggal" type="date" value="${esc(data.tanggal)}" data-qr-tanggal />` : ''}
        <button class="mini-btn" type="button" data-qr-muat>Muat ulang</button>
      </div>
      <div class="qris-isi">${ctx.tab === 'SETELAN' ? renderSetelan() : ctx.tab === 'KOLAM' ? renderKolam() : ctx.tab === 'MUTASI' ? renderMutasi() : renderHarian()}</div>`;
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
    const filterKlaim = node.querySelector('[data-qr-klaim-filter]');
    if (filterKlaim) filterKlaim.onchange = () => { ctx.klaim = filterKlaim.value; aksi(async () => {}, filterKlaim); };
    on('[data-qr-tab]', button => { ctx.tab = button.dataset.qrTab; ctx.tokenBaru = null; aksi(async () => {}); });
    const tanggal = node.querySelector('[data-qr-tanggal]');
    if (tanggal) tanggal.onchange = () => { ctx.tanggal = tanggal.value; aksi(async () => {}); };
    on('[data-mt-baca]', button => aksi(() => bacaUnggahMutasi(node, button), button));
    const tanggalMutasi = node.querySelector('[data-mt-tanggal]');
    if (tanggalMutasi) tanggalMutasi.onchange = () => { ctx.mutasiTanggal = tanggalMutasi.value; aksi(async () => {}); };
    on('[data-mt-peta-simpan]', button => aksi(async () => {
      const mid = button.dataset.mtPetaSimpan;
      await post('mutasi/peta', { mid, storeCode: node.querySelector(`[data-mt-peta="${mid}"]`).value });
      toast('Outlet dipasangkan ✓');
    }, button));
    on('[data-mt-pindah]', button => aksi(async () => {
      const catatan = window.prompt('Pindahkan uang ini ke gerai sesuai mutasi? Klaim & tautan lama dilepas. Catatan (opsional):');
      if (catatan === null) throw new Error('Dibatalkan.');
      await post('mutasi/pindah', { mutasiId: button.dataset.mtPindah, catatan });
      toast('Dipindahkan ✓');
    }, button));
    on('[data-mt-buat]', button => aksi(async () => {
      if (!window.confirm('Buat uang masuk dari baris mutasi ini (notifikasinya tidak sampai)?')) throw new Error('Dibatalkan.');
      await post('mutasi/buat-masuk', { mutasiId: button.dataset.mtBuat });
      toast('Uang masuk dibuat ✓');
    }, button));
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
    ctx = { api, storeCode, tanggal: '', data: null, tab: tab || (kolam ? 'KOLAM' : 'HARIAN'), kolam, klaim: 'BELUM', kolamData: null, kolamError: '', pilihSale: null, setelan: null, tokenBaru: null, onClose };
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

  // ---- Pilih uang QRIS untuk satu penjualan (Bos Cyo, 2026-10-17) -----------------------------
  // Dari tombol kecil QRIS di menu Data (merah = belum, hijau = tertaut) dan otomatis sesudah
  // penjualan QRIS/campuran disimpan. "Pakai" = klaim (bila masih di kolam) + tautkan sekaligus.
  function pilihDialog() {
    let node = document.getElementById('qrisPilihDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'qrisPilihDialog';
    node.className = 'info-gerai-dialog qris-dialog';
    document.body.appendChild(node);
    return node;
  }

  async function pilihPenjualan({ api, saleId, otomatis = false, onDone = null }) {
    let data;
    try { data = await api(`/api/qris/kandidat?saleId=${encodeURIComponent(saleId)}`); }
    catch (error) { if (!otomatis) toast(error.message); return; }
    if (!data.qris) { if (!otomatis) toast('Penjualan ini bukan pembayaran QRIS.'); return; }
    if (otomatis && data.tautan) return; // sudah tertaut sendiri (mis. hanya satu yang cocok)
    const node = pilihDialog();
    const selesai = () => { if (node.open) node.close(); onDone?.(); };
    const muat = () => pilihPenjualan({ api, saleId, otomatis: false, onDone });
    const s = data.sale;
    const bagian = s.campuran ? ` (bagian QRIS dari ${rp(s.total)})` : '';
    let isi;
    if (data.tautan) {
      const t = data.tautan;
      isi = `<div class="qris-pilih-row"><div><strong>✅ Tertaut ke uang masuk ${rp(t.amount)}</strong>
          <div class="muted">${jam(t.receivedAt)}${t.sumberBayar ? ` · dari ${esc(t.sumberBayar)}` : ''}${t.claimedByName ? ` · diklaim ${esc(t.claimedByName)}` : ''}</div></div></div>
        ${t.bisaBatal ? '<button class="secondary-btn" type="button" data-qp-batal>Batal klaim & tautan</button>' : '<p class="muted">Tautan ini hanya bisa dibatalkan admin.</p>'}`;
    } else if (data.kandidat.length) {
      isi = `<p class="muted">Pilih uang QRIS milik pembeli ini. Yang dipilih langsung terkunci untuk gerai ini.</p>
        ${data.kandidat.map(item => `<div class="qris-pilih-row"><div><strong>${rp(item.amount)}</strong> · ${jam(item.receivedAt)}${item.sumberBayar ? ` · dari ${esc(item.sumberBayar)}` : ''}
          <div class="muted">${item.dariKolam ? 'Di kolam (belum diklaim)' : 'Sudah diklaim gerai ini'}</div></div>
          <button class="primary-btn" type="button" data-qp-pakai="${esc(item.id)}">Pakai</button></div>`).join('')}`;
    } else {
      isi = `<p>Uang QRIS ${rp(s.amount)} belum masuk.</p><p class="muted">Tunggu beberapa detik lalu tekan Muat ulang, atau tautkan nanti lewat tombol merah QRIS di 📊 Data.</p>`;
    }
    node.innerHTML = `<div class="info-gerai-head"><div><h2>📲 Pilih uang QRIS-nya</h2>
        <div class="muted">Penjualan ${jam(s.createdAt)} · ${rp(s.amount)}${bagian}</div></div>
        <button class="secondary-btn" type="button" data-qp-tutup>Tutup</button></div>
      ${isi}
      <div style="margin-top:12px"><button class="mini-btn" type="button" data-qp-muat>Muat ulang</button></div>`;
    node.querySelector('[data-qp-tutup]').onclick = selesai;
    node.querySelector('[data-qp-muat]').onclick = muat;
    node.querySelectorAll('[data-qp-pakai]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/api/qris/klaim-tautkan', { method: 'POST', body: JSON.stringify({ masukId: button.dataset.qpPakai, saleId }) });
          toast('QRIS tertaut ✓');
          selesai();
        } catch (error) { toast(error.message); muat(); }
      };
    });
    const batal = node.querySelector('[data-qp-batal]');
    if (batal) batal.onclick = async () => {
      if (!window.confirm('Batalkan klaim & tautan? Uang ini kembali ke kolam dan bisa diklaim gerai lain.')) return;
      batal.disabled = true;
      try { await api('/api/qris/batal-klaim', { method: 'POST', body: JSON.stringify({ masukId: data.tautan.id }) }); toast('Dibatalkan'); selesai(); }
      catch (error) { toast(error.message); batal.disabled = false; }
    };
    if (!node.open) node.showModal();
  }

  window.QrisOtomatis = { open, ringkasan, refreshIfOpen, pilihPenjualan };
})();
