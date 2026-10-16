// Info Gerai (Bos Cyo, 2026-10-16) -- satu tampilan dipakai kasir dan Entity Admin.
// Pemanggil memberi fungsi api(path, options) miliknya sendiri (token kasir / Entity Admin),
// jadi modul ini tidak tahu-menahu soal login. Server (src/info-gerai.js) yang menegakkan
// siapa boleh melihat/mengubah apa; tombol di sini hanya disembunyikan supaya tidak percuma.
(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const when = value => {
    try { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value)); }
    catch { return value || ''; }
  };

  const LAPORAN_KATEGORI = ['Listrik', 'Peralatan', 'Bangunan / Neon box', 'Stok habis', 'Kebersihan', 'Keamanan', 'Kontak', 'Lainnya'];
  const KONTAK_KATEGORI = ['Es Batu', 'Plastik', 'Gas', 'Air Galon', 'Tukang Listrik', 'Servis Alat', 'Lainnya'];
  const SEVERITY = {
    MERAH: { label: 'Mengganggu jualan', dot: '🔴', chip: 'bad' },
    KUNING: { label: 'Perlu segera', dot: '🟡', chip: 'warn' },
    HIJAU: { label: 'Bisa nanti', dot: '🟢', chip: 'ok' }
  };
  const STATUS = { BARU: ['Baru', 'bad'], DILIHAT: ['Dilihat admin', 'warn'], DITANGANI: ['Sedang ditangani', 'warn'], SELESAI: ['Selesai', 'ok'] };
  const SIFAT = { UMUM: 'Umum (semua bisa lihat)', ADMIN: 'Admin saja', RAHASIA: 'Rahasia (Entity Admin & Owner)' };
  const PRIORITAS = ['Utama', 'Cadangan 1', 'Cadangan 2', 'Cadangan 3'];

  let ctx = null; // { api, storeCode, data, tab, search, laporanFilter, view }

  function dialog() {
    let node = document.getElementById('infoGeraiDialog');
    if (node) return node;
    node = document.createElement('dialog');
    node.id = 'infoGeraiDialog';
    node.className = 'info-gerai-dialog';
    node.addEventListener('close', () => ctx?.onClose?.());
    document.body.appendChild(node);
    return node;
  }

  function toast(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    if (typeof window.entityAdminToast === 'function') return window.entityAdminToast(message);
    window.alert(message);
  }

  const path = (suffix = '') => `/api/info-gerai${suffix}?store=${encodeURIComponent(ctx.storeCode)}`;

  async function reload() {
    ctx.data = await ctx.api(path());
    render();
  }

  // ---- Foto -----------------------------------------------------------------
  async function fotoKeDataUrl(file) {
    if (!file) return '';
    if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Foto tidak bisa dibaca.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Foto tidak bisa dibuka.'));
      img.src = source;
    });
    const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  async function lihatFoto(id, holder) {
    holder.innerHTML = '<span class="muted">Memuat foto…</span>';
    try {
      const data = await ctx.api(path(`/${encodeURIComponent(id)}/foto`));
      holder.innerHTML = `<img src="${data.photoDataUrl}" alt="Foto" class="info-gerai-foto" />`;
    } catch (error) { holder.innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
  }

  // ---- Kontak: tombol WA / telepon / peta ----------------------------------
  function nomorWa(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
    return digits;
  }

  function cocok(entry) {
    const q = ctx.search.trim().toLowerCase();
    if (!q) return true;
    return [entry.title, entry.body, entry.category, entry.resolution, entry.phone].join(' ').toLowerCase().includes(q);
  }

  const chip = (label, kind = '') => `<span class="status-chip ${kind}">${esc(label)}</span>`;
  const sifatChip = entry => entry.visibility === 'UMUM' ? '' : chip(entry.visibility === 'ADMIN' ? 'Admin saja' : 'Rahasia', 'off');
  const lingkupChip = entry => entry.allStores ? chip('Semua gerai', 'off') : '';

  function kelolaButtons(entry) {
    if (!entry.canEdit) return '';
    return `<button class="mini-btn" type="button" data-ig-edit="${esc(entry.id)}">Ubah</button>
      <button class="mini-btn danger" type="button" data-ig-hapus="${esc(entry.id)}">Hapus</button>`;
  }

  function kontakCard(entry) {
    const wa = nomorWa(entry.phone);
    const pesan = encodeURIComponent(`Halo ${entry.title}, dari ${ctx.data.store.storeName || ctx.storeCode}. `);
    return `<div class="info-gerai-card">
      <div class="info-gerai-card-head"><strong>${esc(entry.title)}</strong>
        ${chip(PRIORITAS[entry.priority] || `Cadangan ${entry.priority}`, entry.priority ? '' : 'ok')}${sifatChip(entry)}${lingkupChip(entry)}</div>
      <div class="muted">${[entry.phone, entry.openHours ? `buka ${entry.openHours}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
      ${entry.body ? `<div class="info-gerai-body">${esc(entry.body)}</div>` : ''}
      <div class="info-gerai-actions">
        ${wa ? `<a class="primary-btn info-gerai-link" href="https://wa.me/${wa}?text=${pesan}" target="_blank" rel="noopener">💬 Chat WA</a>
          <a class="secondary-btn info-gerai-link" href="tel:+${wa}">📞 Telepon</a>` : ''}
        ${entry.mapsUrl ? `<a class="secondary-btn info-gerai-link" href="${esc(entry.mapsUrl)}" target="_blank" rel="noopener">📍 Buka Peta</a>` : ''}
        <button class="mini-btn" type="button" data-ig-kontak-salah="${esc(entry.id)}">⚠️ Nomor salah / tutup</button>
        ${kelolaButtons(entry)}
      </div>
    </div>`;
  }

  function aktivitasHtml(entry) {
    const items = entry.activity.map(item => `<div class="info-gerai-activity">${item.kind === 'STATUS' ? '🔄' : '💬'} <b>${esc(item.actorName)}</b> · <span class="muted">${esc(when(item.createdAt))}</span><div>${esc(item.body)}</div></div>`).join('');
    return `${items}
      <form class="info-gerai-note" data-ig-catatan="${esc(entry.id)}">
        <input class="text-input" name="body" maxlength="1000" placeholder="Tambah catatan…" />
        <button class="mini-btn" type="submit">Kirim</button>
      </form>`;
  }

  function laporanCard(entry) {
    const sev = SEVERITY[entry.severity] || SEVERITY.KUNING;
    const [statusLabel, statusChip] = STATUS[entry.status] || [entry.status, ''];
    const kelola = entry.canEdit && entry.status !== 'SELESAI' ? `
      <div class="info-gerai-actions">
        ${entry.status === 'BARU' ? `<button class="mini-btn" type="button" data-ig-status="DILIHAT" data-id="${esc(entry.id)}">👁 Sudah dilihat</button>` : ''}
        ${entry.status !== 'DITANGANI' ? `<button class="mini-btn" type="button" data-ig-status="DITANGANI" data-id="${esc(entry.id)}">🛠 Sedang ditangani</button>` : ''}
        <button class="primary-btn" type="button" data-ig-selesai="${esc(entry.id)}">✅ Tandai selesai</button>
      </div>` : '';
    return `<div class="info-gerai-card severity-${esc(entry.severity || 'KUNING')}">
      <div class="info-gerai-card-head"><strong>${sev.dot} ${esc(entry.title)}</strong>
        ${chip(statusLabel, statusChip)}${entry.source === 'SIDAK' ? chip('Temuan sidak', 'warn') : ''}${sifatChip(entry)}</div>
      <div class="muted">${esc(entry.category || 'Lainnya')} · ${esc(sev.label)} · ${esc(entry.createdByName)} · ${esc(when(entry.createdAt))}</div>
      ${entry.body ? `<div class="info-gerai-body">${esc(entry.body)}</div>` : ''}
      ${entry.status === 'SELESAI' ? `<div class="info-gerai-body info-gerai-solusi"><b>Solusi:</b> ${esc(entry.resolution)}<div class="muted">${esc(entry.resolvedByName)} · ${esc(when(entry.resolvedAt))}</div></div>` : ''}
      ${entry.hasPhoto ? `<div data-ig-foto-holder="${esc(entry.id)}"><button class="mini-btn" type="button" data-ig-foto="${esc(entry.id)}">🖼 Lihat foto</button></div>` : ''}
      <div class="info-gerai-actions">
        ${entry.status !== 'SELESAI' ? `<button class="mini-btn" type="button" data-ig-saya-juga="${esc(entry.id)}">👀 Saya juga lihat${entry.sayaJuga ? ` (${entry.sayaJuga})` : ''}</button>` : ''}
        ${entry.canEdit ? `<button class="mini-btn danger" type="button" data-ig-hapus="${esc(entry.id)}">Hapus</button>` : ''}
      </div>
      ${kelola}
      <details class="info-gerai-details"><summary>Catatan (${entry.activity.length})</summary>${aktivitasHtml(entry)}</details>
    </div>`;
  }

  function panduanCard(entry) {
    return `<div class="info-gerai-card">
      <div class="info-gerai-card-head"><strong>📘 ${esc(entry.title)}</strong>
        ${entry.category ? chip(entry.category) : ''}${entry.sourceEntryId ? chip('Dari laporan', 'ok') : ''}${sifatChip(entry)}${lingkupChip(entry)}</div>
      <div class="info-gerai-body">${esc(entry.body)}</div>
      <div class="muted">${esc(entry.createdByName)} · ${esc(when(entry.updatedAt))}</div>
      <div class="info-gerai-actions">
        <button class="mini-btn" type="button" data-ig-nilai="MEMBANTU" data-id="${esc(entry.id)}">👍 Membantu${entry.membantu ? ` (${entry.membantu})` : ''}</button>
        <button class="mini-btn" type="button" data-ig-nilai="KURANG_JELAS" data-id="${esc(entry.id)}">👎 Kurang jelas${entry.kurangJelas ? ` (${entry.kurangJelas})` : ''}</button>
        ${kelolaButtons(entry)}
      </div>
    </div>`;
  }

  function daftar() {
    const entries = ctx.data.entries.filter(cocok);
    const canManage = ctx.data.canManage;
    if (ctx.tab === 'KONTAK') {
      const list = entries.filter(entry => entry.kind === 'KONTAK');
      const groups = new Map();
      for (const entry of list.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))) {
        const key = entry.category || 'Lainnya';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
      }
      return `${canManage ? '<button class="secondary-btn" type="button" data-ig-baru="KONTAK">＋ Tambah kontak</button>' : ''}
        ${[...groups].map(([name, items]) => `<h3 class="info-gerai-group">${esc(name)}</h3>${items.map(kontakCard).join('')}`).join('')
        || '<div class="empty">Belum ada kontak darurat. Admin bisa menambahkannya di sini.</div>'}`;
    }
    if (ctx.tab === 'LAPORAN') {
      const all = entries.filter(entry => entry.kind === 'LAPORAN');
      const rank = { MERAH: 0, KUNING: 1, HIJAU: 2 };
      const open = all.filter(entry => entry.status !== 'SELESAI').sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdAt.localeCompare(a.createdAt));
      const done = all.filter(entry => entry.status === 'SELESAI');
      const list = ctx.laporanFilter === 'SELESAI' ? done : open;
      return `<div class="info-gerai-filter">
          <button class="mini-btn ${ctx.laporanFilter !== 'SELESAI' ? 'active' : ''}" type="button" data-ig-filter="TERBUKA">Belum beres (${open.length})</button>
          <button class="mini-btn ${ctx.laporanFilter === 'SELESAI' ? 'active' : ''}" type="button" data-ig-filter="SELESAI">Sudah beres (${done.length})</button>
        </div>
        ${list.map(laporanCard).join('') || `<div class="empty">${ctx.laporanFilter === 'SELESAI' ? 'Belum ada laporan yang selesai.' : 'Tidak ada masalah yang terbuka. 👍'}</div>`}`;
    }
    const list = entries.filter(entry => entry.kind === 'PANDUAN');
    return `${canManage ? '<button class="secondary-btn" type="button" data-ig-baru="PANDUAN">＋ Tulis panduan</button>' : ''}
      ${list.map(panduanCard).join('') || '<div class="empty">Belum ada panduan. Laporan yang ditandai selesai otomatis jadi panduan di sini.</div>'}`;
  }

  function render() {
    const node = dialog();
    const { data } = ctx;
    if (ctx.view) return renderForm(node);
    const openCount = data.entries.filter(entry => entry.kind === 'LAPORAN' && entry.status !== 'SELESAI').length;
    const tab = (id, label) => `<button class="info-gerai-tab ${ctx.tab === id ? 'active' : ''}" type="button" data-ig-tab="${id}">${label}</button>`;
    node.innerHTML = `
      <div class="info-gerai-head">
        <div><h2>ℹ️ Info Gerai</h2><div class="muted">${esc(data.store.code)} · ${esc(data.store.storeName || '')}</div></div>
        <button class="secondary-btn" type="button" data-ig-tutup>Tutup</button>
      </div>
      <button class="primary-btn info-gerai-lapor" type="button" data-ig-baru="LAPORAN">＋ Laporkan Masalah</button>
      <input class="text-input info-gerai-search" type="search" placeholder="Cari: es batu, listrik, neon box…" value="${esc(ctx.search)}" data-ig-cari />
      <div class="info-gerai-tabs">${tab('KONTAK', '📞 Kontak Darurat')}${tab('LAPORAN', `⚠️ Laporan${openCount ? ` (${openCount})` : ''}`)}${tab('PANDUAN', '📘 Panduan & Solusi')}</div>
      <div class="info-gerai-list">${daftar()}</div>`;
    bind(node);
  }

  async function aksi(fn, button) {
    if (button) button.disabled = true;
    try { await fn(); await reload(); }
    catch (error) { toast(error.message); if (button) button.disabled = false; }
  }

  function bind(node) {
    node.querySelector('[data-ig-tutup]').onclick = () => node.close();
    const cari = node.querySelector('[data-ig-cari]');
    cari.oninput = () => {
      ctx.search = cari.value;
      node.querySelector('.info-gerai-list').innerHTML = daftar();
      bindList(node);
    };
    node.querySelectorAll('[data-ig-tab]').forEach(button => button.onclick = () => { ctx.tab = button.dataset.igTab; render(); });
    node.querySelector('.info-gerai-lapor').onclick = () => { ctx.view = { kind: 'LAPORAN' }; render(); };
    bindList(node);
  }

  function bindList(node) {
    const byId = id => ctx.data.entries.find(entry => entry.id === id);
    node.querySelectorAll('[data-ig-baru]').forEach(button => button.onclick = () => { ctx.view = { kind: button.dataset.igBaru }; render(); });
    node.querySelectorAll('[data-ig-filter]').forEach(button => button.onclick = () => { ctx.laporanFilter = button.dataset.igFilter; render(); });
    node.querySelectorAll('[data-ig-edit]').forEach(button => button.onclick = () => { const entry = byId(button.dataset.igEdit); ctx.view = { kind: entry.kind, entry }; render(); });
    node.querySelectorAll('[data-ig-hapus]').forEach(button => button.onclick = () => {
      if (!window.confirm('Hapus catatan ini dari Info Gerai?')) return;
      aksi(() => ctx.api(path(`/${encodeURIComponent(button.dataset.igHapus)}`), { method: 'DELETE' }), button);
    });
    node.querySelectorAll('[data-ig-foto]').forEach(button => button.onclick = () => lihatFoto(button.dataset.igFoto, node.querySelector(`[data-ig-foto-holder="${CSS.escape(button.dataset.igFoto)}"]`)));
    node.querySelectorAll('[data-ig-saya-juga]').forEach(button => button.onclick = () =>
      aksi(() => ctx.api(path(`/${encodeURIComponent(button.dataset.igSayaJuga)}/aktivitas`), { method: 'POST', body: JSON.stringify({ kind: 'SAYA_JUGA' }) }), button));
    node.querySelectorAll('[data-ig-nilai]').forEach(button => button.onclick = () =>
      aksi(() => ctx.api(path(`/${encodeURIComponent(button.dataset.id)}/aktivitas`), { method: 'POST', body: JSON.stringify({ kind: button.dataset.igNilai }) }), button));
    node.querySelectorAll('[data-ig-status]').forEach(button => button.onclick = () =>
      aksi(() => ctx.api(path(`/${encodeURIComponent(button.dataset.id)}/status`), { method: 'POST', body: JSON.stringify({ status: button.dataset.igStatus }) }), button));
    node.querySelectorAll('[data-ig-selesai]').forEach(button => button.onclick = () => { ctx.view = { kind: 'SELESAI', entry: byId(button.dataset.igSelesai) }; render(); });
    node.querySelectorAll('[data-ig-catatan]').forEach(form => form.onsubmit = event => {
      event.preventDefault();
      const body = form.body.value.trim();
      if (!body) return;
      aksi(() => ctx.api(path(`/${encodeURIComponent(form.dataset.igCatatan)}/aktivitas`), { method: 'POST', body: JSON.stringify({ kind: 'CATATAN', body }) }), form.querySelector('button'));
    });
    node.querySelectorAll('[data-ig-kontak-salah]').forEach(button => button.onclick = () => {
      const entry = byId(button.dataset.igKontakSalah);
      const alasan = window.prompt(`Apa yang salah dengan kontak ${entry.title}? (mis. nomor tidak aktif, toko tutup)`, '');
      if (alasan === null) return;
      aksi(async () => {
        await ctx.api(path(), { method: 'POST', body: JSON.stringify({ kind: 'LAPORAN', category: 'Kontak', severity: 'HIJAU', title: `Kontak ${entry.title} perlu diperbarui`, body: alasan }) });
        toast('Terima kasih, admin akan memperbarui kontaknya.');
      }, button);
    });
  }

  // ---- Form tambah / ubah / selesai ----------------------------------------
  const field = (label, inner, note = '') => `<label class="admin-field">${label}${note ? ` <span class="field-note">${note}</span>` : ''}${inner}</label>`;
  const options = (list, current) => list.map(item => `<option value="${esc(item)}" ${item === current ? 'selected' : ''}>${esc(item)}</option>`).join('');

  function sifatField(entry) {
    const max = ctx.data.maxVisibility;
    const allowed = Object.keys(SIFAT).filter(key => key === 'UMUM' || key === 'ADMIN' || max === 'RAHASIA');
    return field('Siapa yang bisa lihat', `<select class="text-input" name="visibility">${allowed.map(key => `<option value="${key}" ${(entry?.visibility || 'UMUM') === key ? 'selected' : ''}>${esc(SIFAT[key])}</option>`).join('')}</select>`);
  }
  const lingkupField = entry => ctx.data.entityWide && !entry
    ? `<label class="admin-check"><input type="checkbox" name="allStores" /> Berlaku untuk semua gerai di Entity</label>` : '';

  function formHtml(view) {
    const entry = view.entry;
    const canManage = ctx.data.canManage;
    if (view.kind === 'SELESAI') {
      return `<h2>✅ Selesaikan: ${esc(entry.title)}</h2>
        ${entry.body ? `<div class="info-gerai-body">${esc(entry.body)}</div>` : ''}
        ${field('Apa solusinya?', '<textarea class="text-input" name="resolution" rows="4" maxlength="3000" required placeholder="mis. MCB turun karena kompor listrik + freezer bersamaan; dinaikkan lagi, kompor dipakai bergantian."></textarea>', 'wajib — ini yang dibaca CS berikutnya')}
        <label class="admin-check"><input type="checkbox" name="jadikanPanduan" checked /> Simpan juga sebagai panduan</label>
        <button class="primary-btn" type="submit">Tandai selesai</button>`;
    }
    if (view.kind === 'LAPORAN') {
      return `<h2>⚠️ Laporkan masalah</h2>
        ${field('Kategori', `<select class="text-input" name="category">${options(LAPORAN_KATEGORI, 'Lainnya')}</select>`)}
        ${field('Apa masalahnya?', '<input class="text-input" name="title" maxlength="120" required placeholder="mis. Lampu neon box mati" />')}
        ${field('Keterangan', '<textarea class="text-input" name="body" rows="3" maxlength="3000" placeholder="Sejak kapan, sudah dicoba apa"></textarea>', 'opsional')}
        <div class="admin-field">Seberapa mendesak?
          <div class="info-gerai-severity">${Object.entries(SEVERITY).map(([key, sev]) => `<label><input type="radio" name="severity" value="${key}" ${key === 'KUNING' ? 'checked' : ''} /> ${sev.dot} ${esc(sev.label)}</label>`).join('')}</div>
          <span class="field-note">🔴 langsung dikirim sebagai notifikasi ke admin.</span></div>
        ${field('Foto', '<input name="photo" type="file" accept="image/*" capture="environment" />', 'opsional')}
        ${canManage ? `${field('Sumber', '<select class="text-input" name="source"><option value="ADMIN">Admin</option><option value="SIDAK">Temuan sidak</option></select>')}${sifatField(null)}` : ''}
        <button class="primary-btn" type="submit">Kirim laporan</button>`;
    }
    if (view.kind === 'KONTAK') {
      const suppliers = ctx.data.suppliers || [];
      return `<h2>📞 ${entry ? 'Ubah' : 'Tambah'} kontak darurat</h2>
        ${!entry && suppliers.length ? field('Isi dari master pemasok', `<select class="text-input" name="supplierId"><option value="">— ketik manual —</option>${suppliers.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select>`, 'opsional') : ''}
        ${field('Kategori', `<input class="text-input" name="category" list="infoGeraiKontakKategori" maxlength="60" required value="${esc(entry?.category || '')}" placeholder="mis. Es Batu" /><datalist id="infoGeraiKontakKategori">${options(KONTAK_KATEGORI)}</datalist>`)}
        ${field('Nama', `<input class="text-input" name="title" maxlength="120" required value="${esc(entry?.title || '')}" placeholder="mis. Es Batu Pak Darto" />`)}
        ${field('No. WA / telepon', `<input class="text-input" name="phone" maxlength="40" inputmode="tel" value="${esc(entry?.phone || '')}" placeholder="0812…" />`)}
        ${field('Jam buka', `<input class="text-input" name="openHours" maxlength="80" value="${esc(entry?.openHours || '')}" placeholder="mis. 06.00–21.00, Minggu tutup" />`)}
        ${field('Lokasi (link Google Maps)', `<input class="text-input" name="mapsUrl" maxlength="500" value="${esc(entry?.mapsUrl || '')}" placeholder="https://maps.app.goo.gl/…" />`, 'buka lokasinya di Google Maps → Bagikan → Salin link')}
        ${field('Urutan', `<select class="text-input" name="priority">${PRIORITAS.map((label, index) => `<option value="${index}" ${(entry?.priority || 0) === index ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
        ${field('Catatan', `<textarea class="text-input" name="body" rows="2" maxlength="3000" placeholder="mis. minimal 5 balok, bisa antar">${esc(entry?.body || '')}</textarea>`, 'opsional')}
        ${sifatField(entry)}${lingkupField(entry)}
        <button class="primary-btn" type="submit">Simpan kontak</button>`;
    }
    return `<h2>📘 ${entry ? 'Ubah' : 'Tulis'} panduan</h2>
      ${field('Kategori', `<select class="text-input" name="category">${options(LAPORAN_KATEGORI, entry?.category || 'Lainnya')}</select>`)}
      ${field('Masalahnya', `<input class="text-input" name="title" maxlength="120" required value="${esc(entry?.title || '')}" placeholder="mis. Es batu habis saat ramai" />`)}
      ${field('Cara mengatasi', `<textarea class="text-input" name="body" rows="7" maxlength="3000" required placeholder="1. Cek freezer cadangan&#10;2. WA pemasok utama&#10;3. Kalau tutup, hubungi cadangan 1">${esc(entry?.body || '')}</textarea>`)}
      ${sifatField(entry)}${lingkupField(entry)}
      <button class="primary-btn" type="submit">Simpan panduan</button>`;
  }

  function renderForm(node) {
    node.innerHTML = `<div class="info-gerai-head"><button class="secondary-btn" type="button" data-ig-kembali>← Kembali</button></div>
      <form class="info-gerai-form">${formHtml(ctx.view)}</form>`;
    node.querySelector('[data-ig-kembali]').onclick = () => { ctx.view = null; render(); };
    const form = node.querySelector('form');
    // Temuan sidak bawaannya "Admin saja" (bisa menyangkut kinerja CS); admin tetap boleh menggantinya.
    if (form.source && form.visibility) form.source.onchange = () => {
      if (form.source.value === 'SIDAK' && form.visibility.value === 'UMUM') form.visibility.value = 'ADMIN';
    };
    const supplier = form.supplierId;
    if (supplier) supplier.onchange = () => {
      const item = (ctx.data.suppliers || []).find(row => row.id === supplier.value);
      if (!item) return;
      form.title.value = item.name;
      if (item.phone) form.phone.value = item.phone;
      if (item.address && !form.body.value) form.body.value = item.address;
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const { kind, entry } = ctx.view;
      try {
        if (kind === 'SELESAI') {
          const result = await ctx.api(path(`/${encodeURIComponent(entry.id)}/status`), { method: 'POST', body: JSON.stringify({ status: 'SELESAI', resolution: form.resolution.value, jadikanPanduan: form.jadikanPanduan.checked }) });
          toast(result.guideId ? 'Selesai — solusinya tersimpan juga di Panduan.' : 'Laporan ditandai selesai.');
        } else {
          const payload = { kind };
          for (const name of ['category', 'title', 'body', 'phone', 'openHours', 'mapsUrl', 'priority', 'visibility', 'source', 'supplierId']) {
            if (form[name] && !(form[name] instanceof RadioNodeList)) payload[name] = form[name].value;
          }
          if (form.severity) payload.severity = form.severity.value;
          if (form.allStores) payload.allStores = form.allStores.checked;
          if (form.photo?.files?.[0]) payload.photoDataUrl = await fotoKeDataUrl(form.photo.files[0]);
          if (entry) await ctx.api(path(`/${encodeURIComponent(entry.id)}`), { method: 'PATCH', body: JSON.stringify(payload) });
          else await ctx.api(path(), { method: 'POST', body: JSON.stringify(payload) });
          toast(kind === 'LAPORAN' ? 'Laporan terkirim. Terima kasih!' : 'Tersimpan.');
          if (kind === 'LAPORAN') { ctx.tab = 'LAPORAN'; ctx.laporanFilter = 'TERBUKA'; }
        }
        ctx.view = null;
        await reload();
      } catch (error) {
        toast(error.message);
        submit.disabled = false;
      }
    };
  }

  async function open({ api, storeCode, tab = 'KONTAK', onClose = null }) {
    ctx = { api, storeCode, data: null, tab, search: '', laporanFilter: 'TERBUKA', view: null, onClose };
    const node = dialog();
    node.innerHTML = '<div class="muted">Memuat Info Gerai…</div>';
    if (!node.open) node.showModal();
    try { await reload(); }
    catch (error) {
      node.innerHTML = `<div class="info-gerai-head"><div>${esc(error.message)}</div><button class="secondary-btn" type="button" data-ig-tutup>Tutup</button></div>`;
      node.querySelector('[data-ig-tutup]').onclick = () => node.close();
    }
  }

  // Satu kali saat halaman dibuka (bukan polling): apakah fitur aktif + jumlah laporan terbuka per gerai.
  async function ringkasan(api, storeCode) {
    try { return await api(`/api/info-gerai/ringkasan?store=${encodeURIComponent(storeCode)}`); }
    catch { return { enabled: false, stores: [] }; }
  }

  window.InfoGerai = { open, ringkasan };
})();
