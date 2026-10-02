// Panel chat Maimunah ("Una") — asisten AI Entity Admin (ADR-044/045).
// Nama kodenya tetap "caca" (nama lamanya, 2026-10-01 diganti Bos Cyo);
// yang berubah hanya yang terlihat orang.
//
// Satu ruang chat saja, meniru WhatsApp: teks dikirim sebagai pertanyaan,
// foto dikirim sebagai lembar rekap, gerainya dipilih sekali di judul.
//
// Panel ini dipasang di dua halaman: Entity Admin dan workspace gerai
// (/s/:kode/admin). Kerangkanya dibuat skrip ini sendiri, jadi halaman cukup
// memuat skrip dan CSS-nya. Percakapan disimpan per tab browser supaya tidak
// hilang waktu Bos pindah dari Entity Admin ke workspace gerai dan kembali.

const CACA_ENTITY = '__entity__';
const CACA_INGAT_GERAI = 'lekerCacaGerai';
const CACA_SIMPANAN = 'lekerUnaPercakapan';
const CACA_MAKS_SIMPAN = 80;

const cacaState = {
  scope: '',
  stores: [],
  entityName: '',
  lampiran: null,
  sedangKirim: false,
  siap: false,
  siapDipakai: false
};

const cacaEl = id => document.getElementById(id);
const cacaEscape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const cacaRupiah = value => (value === null || value === undefined ? '—' : new Intl.NumberFormat('id-ID').format(value));
const cacaJam = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

async function cacaApi(path, options = {}) {
  const token = localStorage.getItem('lekerEntityAdminToken') || '';
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Permintaan gagal (${response.status})`);
  return payload;
}

function cacaBacaBerkas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gambarnya tidak terbaca.'));
    reader.onload = () => {
      const hasil = String(reader.result || '');
      const pemisah = hasil.indexOf(',');
      if (pemisah < 0) return reject(new Error('Gambarnya tidak terbaca.'));
      resolve({ media_type: file.type, data: hasil.slice(pemisah + 1) });
    };
    reader.readAsDataURL(file);
  });
}

// --- kerangka panel --------------------------------------------------------

const CACA_KERANGKA = `
  <button id="cacaFab" class="caca-fab hidden" type="button" aria-expanded="false" aria-controls="cacaPanel" title="Tanya Una">
    <span class="caca-fab-ikon" aria-hidden="true">U</span>
    <span class="caca-fab-teks">Una</span>
  </button>
  <div id="cacaPanel" class="caca-melayang hidden" role="dialog" aria-label="Maimunah (Una)" aria-modal="false">
    <div class="caca-kepala">
      <span class="caca-avatar" aria-hidden="true">U</span>
      <div class="caca-kepala-teks">
        <button id="cacaPilihGerai" class="caca-judul" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="cacaDaftarGerai">
          <span id="cacaJudulGerai">Memuat gerai…</span>
          <span class="caca-panah" aria-hidden="true">▾</span>
        </button>
        <div class="caca-subjudul" id="cacaStatus">Memuat…</div>
      </div>
      <button id="cacaTutup" class="caca-ikon-btn" type="button" aria-label="Tutup Una">✕</button>
      <ul id="cacaDaftarGerai" class="caca-daftar-gerai hidden" role="listbox" aria-label="Pilih gerai yang dibahas"></ul>
    </div>
    <div id="cacaPercakapan" class="caca-percakapan" aria-live="polite"></div>
    <div id="cacaLampiran" class="caca-lampiran hidden">
      <img id="cacaLampiranGambar" alt="Foto yang akan dikirim" />
      <div class="caca-lampiran-teks"><strong>Foto lembar rekap</strong><span id="cacaLampiranNama"></span></div>
      <button id="cacaLampiranBuang" class="caca-ikon-btn" type="button" aria-label="Batal kirim foto">✕</button>
    </div>
    <form id="cacaTanyaForm" class="caca-ketik">
      <button id="cacaLampirkan" class="caca-ikon-btn caca-tambah" type="button" aria-label="Kirim foto lembar rekap" title="Kirim foto lembar rekap">+</button>
      <input id="cacaGambar" type="file" accept="image/*" hidden />
      <input id="cacaPertanyaan" maxlength="500" placeholder="Ketik pesan" autocomplete="off" />
      <button id="cacaTanyaKirim" class="caca-kirim" type="submit" aria-label="Kirim" disabled>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.1 15 12 3.4 13.9z"/></svg>
      </button>
    </form>
  </div>`;

// Dipanggil dari mana pun yang lebih dulu butuh panelnya: entity-admin.js bisa
// memanggil cacaSetTampil sebelum DOMContentLoaded skrip ini sendiri.
function cacaPasangKerangka() {
  if (cacaEl('cacaPanel')) return;
  const wadah = document.createElement('div');
  // Di workspace gerai pojok kanan bawah sudah dipakai tombol "Ganti Gerai"
  // (admin-workspace-switcher.js); tombol Una digeser ke sebelah kirinya.
  wadah.className = cacaDiWorkspace() ? 'caca-akar caca-di-workspace' : 'caca-akar';
  wadah.innerHTML = CACA_KERANGKA;
  document.body.appendChild(wadah);
  cacaPulihkanPercakapan();
}

// --- percakapan yang bertahan antar halaman ---------------------------------
//
// Disimpan di sessionStorage, bukan localStorage: hidup selama tab browser
// itu terbuka, dan hilang begitu tabnya ditutup. Isinya angka keuangan, jadi
// tidak dibiarkan tertinggal di komputer bersama. Sidik login ikut disimpan:
// login orang lain di tab yang sama tidak mewarisi percakapan sebelumnya.

function cacaSidikLogin() {
  const token = localStorage.getItem('lekerEntityAdminToken') || '';
  let hash = 0;
  for (const huruf of token) hash = (hash * 31 + huruf.charCodeAt(0)) | 0;
  return token ? String(hash) : '';
}

function cacaSimpanPercakapan() {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return;
  const salinan = wadah.cloneNode(true);
  salinan.querySelectorAll('.mengetik').forEach(el => el.remove());
  // Foto lembar rekap memakai alamat sementara yang mati begitu halaman
  // berganti, jadi yang disimpan cuma tandanya.
  salinan.querySelectorAll('img.caca-foto').forEach(img => {
    const tanda = document.createElement('p');
    tanda.textContent = '📷 Foto lembar rekap';
    img.replaceWith(tanda);
  });
  while (salinan.childElementCount > CACA_MAKS_SIMPAN) salinan.firstElementChild.remove();
  try {
    sessionStorage.setItem(CACA_SIMPANAN, JSON.stringify({ sidik: cacaSidikLogin(), html: salinan.innerHTML }));
  } catch { /* penuh atau diblokir: percakapan tetap jalan, cuma tidak bertahan */ }
}

function cacaHapusSimpanan() {
  try { sessionStorage.removeItem(CACA_SIMPANAN); } catch { /* boleh gagal */ }
}

// Draft yang belum dijawab tidak ikut hidup lagi. Tombol "Ya"-nya kehilangan
// isi draft yang dipegang halaman sebelumnya, dan menghidupkannya dari HTML
// saja berarti memposting sesuatu yang tidak lagi bisa dicek ulang di sini.
function cacaPulihkanPercakapan() {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return;
  let simpanan = null;
  try { simpanan = JSON.parse(sessionStorage.getItem(CACA_SIMPANAN) || 'null'); } catch { simpanan = null; }
  if (!simpanan?.html) return;
  if (simpanan.sidik !== cacaSidikLogin()) {
    cacaHapusSimpanan();
    return;
  }
  wadah.innerHTML = simpanan.html;
  wadah.querySelectorAll('.caca-draft:not(.tercatat):not(.dibatalkan)').forEach(kartu => {
    kartu.classList.add('kedaluwarsa');
    kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (!kartu.querySelector('.caca-draft-catatan')) {
      const catatan = document.createElement('p');
      catatan.className = 'caca-draft-catatan';
      catatan.textContent = 'Draft ini dari halaman sebelumnya. Kirim ulang perintahnya kalau masih perlu.';
      kartu.appendChild(catatan);
    }
  });
  cacaGulirKeBawah();
}

// --- gerai yang dibahas -----------------------------------------------------

function cacaIngat(scope) {
  try { localStorage.setItem(CACA_INGAT_GERAI, scope); } catch { /* boleh gagal */ }
}

function cacaIngatan() {
  try { return localStorage.getItem(CACA_INGAT_GERAI) || ''; } catch { return ''; }
}

function cacaNamaScope(scope) {
  if (scope === CACA_ENTITY) return `${cacaState.entityName || 'Entity'} · semua gerai`;
  const store = cacaState.stores.find(item => item.code === scope);
  return store ? store.storeName : 'Pilih gerai';
}

// Gerai yang dikirim ke server. Mode entity tidak pernah mengirim ?store=:
// tanpa itu server akan jatuh ke gerai bawaan, jadi mode entity memakai
// ?lingkup=entity yang dilayani terpisah.
function cacaGeraiAktif() {
  return cacaState.scope && cacaState.scope !== CACA_ENTITY ? cacaState.scope : '';
}

function cacaQueryLingkup(scope) {
  if (scope === CACA_ENTITY) return 'lingkup=entity';
  return `store=${encodeURIComponent(scope)}`;
}

async function cacaMuatGerai() {
  const payload = await cacaApi('/api/entity-admin/stores');
  cacaState.stores = payload.stores || [];
  cacaState.entityName = payload.entityAdmin?.entityName || '';

  // Di workspace gerai, yang dibahas adalah gerai yang sedang dibuka.
  const geraiHalaman = cacaDiWorkspace() ? String(window.LEKER_STORE_CODE || '').toUpperCase() : '';
  const ingatan = cacaState.stores.some(store => store.code === geraiHalaman) ? geraiHalaman : cacaIngatan();
  const masihAda = ingatan === CACA_ENTITY || cacaState.stores.some(store => store.code === ingatan);
  cacaState.scope = masihAda ? ingatan : (cacaState.stores[0]?.code || '');
  cacaRenderDaftarGerai();
  cacaEl('cacaJudulGerai').textContent = cacaState.scope ? cacaNamaScope(cacaState.scope) : 'Belum ada gerai';
}

function cacaRenderDaftarGerai() {
  const daftar = cacaEl('cacaDaftarGerai');
  if (!daftar) return;
  const baris = (scope, nama, keterangan) => `
    <li role="option" tabindex="-1" data-caca-scope="${cacaEscape(scope)}" aria-selected="${scope === cacaState.scope}">
      <span class="caca-avatar kecil" aria-hidden="true">${cacaEscape((nama || '?').slice(0, 1).toUpperCase())}</span>
      <span><strong>${cacaEscape(nama)}</strong><small>${cacaEscape(keterangan)}</small></span>
    </li>`;

  daftar.innerHTML = [
    baris(CACA_ENTITY, cacaNamaScope(CACA_ENTITY), 'Buku entity — untuk jurnal'),
    ...cacaState.stores.map(store => baris(store.code, store.storeName, store.code))
  ].join('');
}

function cacaToggleDaftarGerai(buka) {
  const daftar = cacaEl('cacaDaftarGerai');
  const tombol = cacaEl('cacaPilihGerai');
  if (!daftar || !tombol) return;
  const tampil = buka ?? daftar.classList.contains('hidden');
  daftar.classList.toggle('hidden', !tampil);
  tombol.setAttribute('aria-expanded', String(tampil));
  if (tampil) daftar.querySelector('[aria-selected="true"]')?.focus();
}

function cacaGantiGerai(scope) {
  cacaToggleDaftarGerai(false);
  if (!scope || scope === cacaState.scope) return;
  cacaState.scope = scope;
  cacaIngat(scope);
  cacaRenderDaftarGerai();
  cacaEl('cacaJudulGerai').textContent = cacaNamaScope(scope);
  // Penanda di tengah percakapan, seperti label tanggal di WhatsApp: jawaban
  // di atasnya dan di bawahnya bisa berasal dari gerai yang berbeda.
  cacaTambahPenanda(`Sekarang membahas ${cacaNamaScope(scope)}`);
  if (scope === CACA_ENTITY) {
    cacaTambahGelembung('caca', 'Di buku entity Una baru bisa membuat jurnal, mis. "jurnal setoran modal 5jt: debit Kas, kredit Modal Pemilik". Laporan dan barang tetap per gerai.');
  }
}

// --- isi percakapan ---------------------------------------------------------

function cacaGulirKeBawah() {
  const wadah = cacaEl('cacaPercakapan');
  if (wadah) wadah.scrollTop = wadah.scrollHeight;
}

function cacaTambahGelembung(dari, teks, catatan = '', { html = '' } = {}) {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return null;
  const gelembung = document.createElement('div');
  gelembung.className = `caca-gelembung ${dari}${html ? ' lebar' : ''}`;
  gelembung.innerHTML = `${html}${teks ? `<p>${cacaEscape(teks)}</p>` : ''}
    <span class="caca-meta">${catatan ? `<span class="caca-jejak">${cacaEscape(catatan)}</span>` : ''}<span class="caca-waktu">${cacaJam()}</span></span>`;
  wadah.appendChild(gelembung);
  cacaGulirKeBawah();
  cacaSimpanPercakapan();
  return gelembung;
}

function cacaTambahMengetik() {
  const wadah = cacaEl('cacaPercakapan');
  const gelembung = document.createElement('div');
  gelembung.className = 'caca-gelembung caca mengetik';
  gelembung.setAttribute('aria-label', 'Una sedang mengetik');
  gelembung.innerHTML = '<span></span><span></span><span></span>';
  wadah.appendChild(gelembung);
  cacaGulirKeBawah();
  return gelembung;
}

function cacaTambahPenanda(teks) {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return;
  const penanda = document.createElement('div');
  penanda.className = 'caca-penanda';
  penanda.textContent = teks;
  wadah.appendChild(penanda);
  cacaGulirKeBawah();
  cacaSimpanPercakapan();
}

const CACA_SARAN = ['untung hari ini berapa?', 'stok tinggal berapa?', 'beli gas 22rb tadi pagi'];

function cacaSapa() {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah || wadah.childElementCount) return;
  cacaTambahPenanda('Hari ini');
  const gelembung = cacaTambahGelembung('caca', 'Halo Bos, Una di sini! Tanya apa saja soal gerai yang dipilih di atas, atau suruh Una mencatat. Mau Una baca lembar rekap? Tekan + di bawah lalu pilih fotonya.');
  const saran = document.createElement('div');
  saran.className = 'caca-saran';
  saran.innerHTML = CACA_SARAN.map(teks => `<button type="button" data-caca-saran="${cacaEscape(teks)}">${cacaEscape(teks)}</button>`).join('');
  gelembung.after(saran);
  cacaSimpanPercakapan();
}

// Yang ditampilkan adalah akibatnya, bukan pengulangan perintah — konfirmasi
// yang cuma mengulang kalimat sendiri gampang di-klik tanpa dibaca.
function cacaIsiDraft(draft) {
  // Draft aksi (barang, resep, jurnal) membawa baris dan tabelnya sendiri;
  // draft pengeluaran yang lebih dulu ada masih memakai bentuk lamanya.
  if (Array.isArray(draft.baris)) {
    const baris = draft.baris.map(([label, nilai]) => `<div class="caca-draft-baris"><span>${cacaEscape(label)}</span><strong>${cacaEscape(nilai)}</strong></div>`).join('');
    const tabel = draft.tabel
      ? `<div class="caca-tabel-geser"><table class="caca-table"><thead><tr>${draft.tabel.kolom.map(k => `<th>${cacaEscape(k)}</th>`).join('')}</tr></thead><tbody>${
          draft.tabel.isi.map(r => `<tr>${r.map(sel => `<td>${cacaEscape(sel)}</td>`).join('')}</tr>`).join('')
        }</tbody></table></div>`
      : '';
    const tombol = draft.aksi === 'buat_jurnal' ? 'Ya, posting'
      : ['buat_barang', 'buat_resep'].includes(draft.aksi) ? 'Ya, buat'
        : ['atur_cara_bayar', 'pindah_saldo_akun'].includes(draft.aksi) ? 'Ya, jalankan'
        : 'Ya, catat';
    return { judul: draft.judul, isi: baris + tabel, tombol };
  }
  return {
    judul: 'Una mau mencatat ini — dicek dulu ya:',
    isi: `
      <div class="caca-draft-baris"><span>Untuk</span><strong>${cacaEscape(draft.keterangan)}</strong></div>
      <div class="caca-draft-baris"><span>Nominal</span><strong>${cacaRupiah(draft.nominal)}</strong></div>
      <div class="caca-draft-baris"><span>Ke</span><strong>${cacaEscape(draft.pihak)}</strong></div>
      <div class="caca-draft-baris"><span>Tanggal</span><strong>${cacaEscape(draft.tanggal)}</strong></div>`,
    tombol: 'Ya, catat'
  };
}

function cacaTampilkanDraft(payload, scope) {
  const draft = payload.draft;
  const tampilan = cacaIsiDraft(draft);
  const html = `
    <div class="caca-draft">
      <div class="caca-draft-judul">${cacaEscape(tampilan.judul)}</div>
      ${tampilan.isi}
      <ul class="caca-draft-dampak">${draft.dampak.map(d => `<li>${cacaEscape(d)}</li>`).join('')}</ul>
      <div class="caca-draft-aksi">
        <button class="primary-btn" type="button" data-caca-catat>${cacaEscape(tampilan.tombol)}</button>
        <button class="secondary-btn" type="button" data-caca-batal>Batal</button>
      </div>
    </div>`;
  const gelembung = cacaTambahGelembung('caca', '', '', { html });
  const kartu = gelembung.querySelector('.caca-draft');
  const kunci = () => kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });

  kartu.querySelector('[data-caca-batal]').addEventListener('click', () => {
    kunci();
    kartu.classList.add('dibatalkan');
    cacaSimpanPercakapan();
    cacaTambahGelembung('caca', 'Oke, tidak jadi.');
  });

  // Gerai/lingkup diambil dari saat draft dibuat, bukan dari judul sekarang:
  // kalau Bos sempat ganti gerai sebelum menekan "Ya", hasilnya tetap masuk ke
  // tempat yang tertulis di draft.
  kartu.querySelector('[data-caca-catat]').addEventListener('click', async () => {
    kunci();
    try {
      const hasil = await cacaApi(`/api/caca/catat?${cacaQueryLingkup(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ draft })
      });
      kartu.classList.add('tercatat');
      cacaSimpanPercakapan();
      cacaTambahGelembung('caca', hasil.jawaban);
    } catch (error) {
      // Tombol dibuka lagi: yang gagal biasanya bisa diulang setelah sebabnya
      // dibereskan, dan menguncinya permanen memaksa mengetik ulang dari awal.
      kartu.querySelectorAll('button').forEach(b => { b.disabled = false; });
      cacaTambahGelembung('caca', error.message);
    }
  });
}

// Tabel hasil alat baca (mis. cek Rekening Bersama). Isinya sudah teks jadi
// dari server; tetap di-escape karena berasal dari data master.
function cacaRenderTabel(tabel) {
  if (!tabel?.kolom?.length) return '';
  return `<div class="caca-tabel-geser"><table class="caca-table"><thead><tr>${tabel.kolom.map(k => `<th>${cacaEscape(k)}</th>`).join('')}</tr></thead><tbody>${
    (tabel.isi || []).map(r => `<tr>${r.map(sel => `<td>${cacaEscape(sel)}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function cacaJejakAlat(payload) {
  if (!payload.alat) return '';
  const periode = payload.periode ? ` · ${payload.periode.dari}${payload.periode.sampai !== payload.periode.dari ? ` s/d ${payload.periode.sampai}` : ''}` : '';
  return `dari ${payload.alat}${periode}`;
}

function cacaRenderBaris(judul, baris, kolom) {
  if (!baris.length) return '';
  const head = kolom.map(k => `<th>${cacaEscape(k.judul)}</th>`).join('');
  const body = baris.map(item => `<tr>${kolom.map(k => `<td>${k.render(item)}</td>`).join('')}</tr>`).join('');
  return `<h4>${cacaEscape(judul)}</h4><div class="caca-tabel-geser"><table class="caca-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function cacaRenderRekap(payload) {
  const hasil = payload.hasil;
  const r = hasil.ringkasan;

  const penjualan = cacaRenderBaris('Penjualan', hasil.penjualan, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Barang di sistem', render: b => (b.product_name ? cacaEscape(b.product_name) : '<span class="caca-warn">belum cocok</span>') },
    { judul: 'Qty', render: b => cacaRupiah(b.qty) },
    { judul: 'Harga', render: b => cacaRupiah(b.harga_satuan) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah_hitung ?? b.jumlah_tertulis) }
  ]);

  const pengeluaran = cacaRenderBaris('Pengeluaran', hasil.pengeluaran, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Banyaknya', render: b => cacaRupiah(b.banyaknya) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah) }
  ]);

  const pengurang = cacaRenderBaris('Pengurang setoran', hasil.pengurang_setoran, [
    { judul: 'Tertulis', render: b => cacaEscape(b.nama_tertulis) },
    { judul: 'Jumlah', render: b => cacaRupiah(b.jumlah) }
  ]);

  const konfirmasi = hasil.perlu_konfirmasi.length
    ? `<div class="caca-konfirmasi"><h4>Una mau memastikan dulu (${hasil.perlu_konfirmasi.length})</h4><ul>${
        hasil.perlu_konfirmasi.map(item => `<li><span class="caca-tag">${cacaEscape(item.jenis)}</span> ${cacaEscape(item.pesan)}</li>`).join('')
      }</ul></div>`
    : '<div class="caca-konfirmasi ok">Tidak ada yang janggal menurut Una.</div>';

  return `
    <div class="caca-ringkas">
      <div><span>Tanggal di lembar</span><strong>${cacaEscape(hasil.tanggal_tertulis || '—')}</strong></div>
      <div><span>Gerai</span><strong>${cacaEscape(payload.store.storeName)}</strong></div>
      <div><span>Total penjualan</span><strong>${cacaRupiah(r.total_penjualan)}</strong></div>
      <div><span>Total pengeluaran</span><strong>${cacaRupiah(r.total_pengeluaran)}</strong></div>
      <div><span>Setoran</span><strong>${cacaRupiah(r.setoran)}</strong></div>
    </div>
    ${konfirmasi}
    ${penjualan}${pengeluaran}${pengurang}
    <p class="caca-catatan">${cacaEscape(payload.catatan)}</p>`;
}

// --- lampiran foto ----------------------------------------------------------

function cacaPasangLampiran(file) {
  cacaBuangLampiran();
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    cacaTambahGelembung('caca', 'Yang bisa Una baca baru foto (gambar) lembar rekap.');
    return;
  }
  cacaState.lampiran = { file, url: URL.createObjectURL(file) };
  cacaEl('cacaLampiranGambar').src = cacaState.lampiran.url;
  cacaEl('cacaLampiranNama').textContent = file.name;
  cacaEl('cacaLampiran').classList.remove('hidden');
  cacaEl('cacaPertanyaan').placeholder = 'Tekan kirim untuk dibaca Una';
  cacaAturTombol();
}

// URL gambar tidak dicabut di sini kalau sudah terkirim: gelembung foto di
// percakapan masih memakainya.
function cacaBuangLampiran({ terkirim = false } = {}) {
  if (cacaState.lampiran && !terkirim) URL.revokeObjectURL(cacaState.lampiran.url);
  cacaState.lampiran = null;
  const input = cacaEl('cacaGambar');
  if (input) input.value = '';
  cacaEl('cacaLampiran')?.classList.add('hidden');
  const kotak = cacaEl('cacaPertanyaan');
  if (kotak) kotak.placeholder = 'Ketik pesan';
  cacaAturTombol();
}

// --- kirim ------------------------------------------------------------------

function cacaAturTombol() {
  const ada = Boolean(cacaState.lampiran) || Boolean(cacaEl('cacaPertanyaan')?.value.trim());
  const tombol = cacaEl('cacaTanyaKirim');
  if (tombol) tombol.disabled = !(cacaState.siap && ada && !cacaState.sedangKirim);
}

function cacaCekGerai({ bolehEntity = false } = {}) {
  if (cacaGeraiAktif() || (bolehEntity && cacaState.scope === CACA_ENTITY)) return true;
  cacaTambahGelembung('caca', cacaState.scope === CACA_ENTITY
    ? 'Lembar rekap dibaca per gerai. Pilih gerainya dulu lewat tombol ▾ di atas.'
    : 'Pilih gerainya dulu lewat tombol ▾ di atas.');
  return false;
}

async function cacaKirimFoto() {
  const { file, url } = cacaState.lampiran;
  cacaBuangLampiran({ terkirim: true });
  cacaTambahGelembung('saya', '', '', { html: `<img class="caca-foto" src="${cacaEscape(url)}" alt="Foto lembar rekap" />` });
  if (!cacaCekGerai()) return;

  const store = cacaGeraiAktif();
  const mengetik = cacaTambahMengetik();
  try {
    const gambar = await cacaBacaBerkas(file);
    const payload = await cacaApi(`/api/caca/baca-rekap?store=${encodeURIComponent(store)}`, {
      method: 'POST',
      body: JSON.stringify({ gambar })
    });
    mengetik.remove();
    cacaTambahGelembung('caca', '', 'dari lembar rekap', { html: cacaRenderRekap(payload) });
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

async function cacaKirimTeks(pertanyaan) {
  cacaTambahGelembung('saya', pertanyaan);
  if (!cacaCekGerai({ bolehEntity: true })) return;

  const scope = cacaState.scope;
  const mengetik = cacaTambahMengetik();
  try {
    const payload = await cacaApi(`/api/caca/tanya?${cacaQueryLingkup(scope)}`, {
      method: 'POST',
      body: JSON.stringify({ pertanyaan })
    });
    mengetik.remove();
    if (payload.perluKonfirmasi && payload.draft) {
      cacaTampilkanDraft(payload, scope);
    } else {
      // Jejak alat sengaja ditampilkan: angka yang muncul harus bisa ditelusuri
      // asalnya, bukan diterima begitu saja karena keluar dari mulut Caca.
      const tabel = cacaRenderTabel(payload.tabel);
      if (tabel) {
        // Kalimatnya di atas tabel, bukan di bawahnya.
        cacaTambahGelembung('caca', '', cacaJejakAlat(payload), { html: `<p>${cacaEscape(payload.jawaban)}</p>${tabel}` });
      } else {
        cacaTambahGelembung('caca', payload.jawaban, cacaJejakAlat(payload));
      }
    }
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

async function cacaKirim(event) {
  event?.preventDefault();
  if (cacaState.sedangKirim || !cacaState.siap) return;
  const input = cacaEl('cacaPertanyaan');
  const teks = input.value.trim();
  if (!cacaState.lampiran && !teks) return;

  cacaState.sedangKirim = true;
  cacaAturTombol();
  cacaEl('cacaPercakapan').querySelector('.caca-saran')?.remove();
  try {
    if (cacaState.lampiran) {
      await cacaKirimFoto();
    } else {
      input.value = '';
      await cacaKirimTeks(teks);
    }
  } finally {
    cacaState.sedangKirim = false;
    cacaAturTombol();
    input.focus();
  }
}

// --- panel melayang ---------------------------------------------------------

// Panel Caca hidup di luar sistem tab, jadi pindah tab tidak menyentuhnya sama
// sekali. Yang menentukan dia ada atau tidak cuma satu hal: masih login Entity
// Admin atau tidak.
function cacaSetTampil(tampil) {
  cacaPasangKerangka();
  cacaEl('cacaFab')?.classList.toggle('hidden', !tampil);
  if (!tampil) cacaTutupPanel();
}

// Keluar dari login = percakapan dibuang saat itu juga, bukan menunggu tab
// ditutup. Sengaja terpisah dari cacaSetTampil(false): halaman Entity Admin
// juga menyembunyikan Una waktu memuat sesi gagal sesaat (mis. koneksi putus),
// dan itu tidak boleh menghapus percakapan.
function cacaLupakan() {
  cacaSetTampil(false);
  cacaHapusSimpanan();
  const wadah = cacaEl('cacaPercakapan');
  if (wadah) wadah.innerHTML = '';
  cacaState.siapDipakai = false;
}

function cacaDiWorkspace() {
  return window.LEKER_PAGE_CONTEXT === 'admin';
}

// Di workspace gerai, Una hanya muncul untuk Entity Admin. Owner yang membuka
// workspace memakai sesi Owner, dan Una belum melayani lewat jalur itu.
function cacaBolehDiWorkspace() {
  return cacaDiWorkspace()
    && Boolean(localStorage.getItem('lekerEntityAdminToken'))
    && !localStorage.getItem('lekerOwnerToken');
}

function cacaTutupPanel() {
  cacaToggleDaftarGerai(false);
  cacaEl('cacaPanel')?.classList.add('hidden');
  cacaEl('cacaFab')?.setAttribute('aria-expanded', 'false');
}

// Panel tidak boleh menutupi tab bar. Kalau menutupi, Bos Cyo harus menutup
// Caca dulu tiap kali mau pindah tab — persis kebalikan dari maksudnya menemani
// sambil kerja. Tinggi tab bar berubah-ubah (di layar sempit dia membungkus
// jadi beberapa baris), jadi batasnya diukur dari posisi aslinya, bukan ditebak
// dengan angka tetap di CSS. Tingginya dibuat tetap (bukan cuma batas atas)
// supaya kotak ketik selalu di dasar panel, seperti aplikasi chat.
function cacaAturTinggiPanel() {
  const panel = cacaEl('cacaPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  const tabBar = document.querySelector('.admin-tabs');
  const batasAtas = tabBar ? tabBar.getBoundingClientRect().bottom + 12 : 80;
  const jarakBawah = window.innerWidth <= 560 ? 76 : 84;
  const tinggi = Math.min(640, Math.max(260, window.innerHeight - batasAtas - jarakBawah));
  panel.style.height = `${tinggi}px`;
}

function cacaBukaPanel() {
  cacaEl('cacaPanel')?.classList.remove('hidden');
  cacaEl('cacaFab')?.setAttribute('aria-expanded', 'true');
  cacaAturTinggiPanel();
  cacaEl('cacaPertanyaan')?.focus();
  // Dimuat sekali saat pertama dibuka; percakapan yang sudah jalan tidak direset
  // waktu panel ditutup-buka lagi.
  if (!cacaState.siapDipakai) cacaMuatPanel();
}

function cacaTogglePanel() {
  const tersembunyi = cacaEl('cacaPanel')?.classList.contains('hidden');
  if (tersembunyi) cacaBukaPanel(); else cacaTutupPanel();
}

// Daftar gerai dan status mesin AI tidak saling bergantung, jadi masing-masing
// gagal sendiri-sendiri. Versi pertama menaruh keduanya dalam satu rantai: cek
// status gagal, daftar gerai ikut tidak dimuat, dan panel jadi kotak kosong
// dengan tombol mati tanpa petunjuk kenapa.
async function cacaMuatPanel() {
  const masalah = [];
  let siap = false;

  try {
    await cacaMuatGerai();
  } catch (error) {
    cacaEl('cacaJudulGerai').textContent = 'Gerai tidak termuat';
    masalah.push(`Daftar gerai gagal dimuat: ${error.message}`);
  }

  try {
    const status = await cacaApi('/api/caca/status');
    siap = Boolean(status.siap);
    if (!siap) masalah.push('Una belum tersambung ke mesin AI — kunci API belum dipasang.');
  } catch (error) {
    masalah.push(`Status Una gagal dimuat: ${error.message}`);
  }

  if (siap && !cacaState.stores.length) masalah.push('Belum ada gerai di entity ini.');

  cacaState.siap = siap && cacaState.stores.length > 0;
  cacaEl('cacaStatus').textContent = masalah.length ? 'Una belum siap' : 'Una · siap membantu';
  cacaEl('cacaStatus').classList.toggle('bermasalah', masalah.length > 0);
  cacaSapa();
  // Alasan lengkapnya masuk ke percakapan, bukan dijejalkan ke subjudul yang
  // cuma muat satu baris.
  for (const pesan of masalah) cacaTambahGelembung('caca', pesan);
  cacaAturTombol();

  // Hanya dianggap selesai kalau semuanya beres, supaya membuka panel lagi
  // mencoba ulang — bukan terjebak di keadaan gagal sampai halaman di-refresh.
  cacaState.siapDipakai = masalah.length === 0;
}

function initCacaPanel() {
  cacaPasangKerangka();
  if (cacaBolehDiWorkspace()) cacaSetTampil(true);

  cacaEl('cacaTanyaForm')?.addEventListener('submit', cacaKirim);
  cacaEl('cacaPertanyaan')?.addEventListener('input', cacaAturTombol);
  cacaEl('cacaLampirkan')?.addEventListener('click', () => cacaEl('cacaGambar')?.click());
  cacaEl('cacaGambar')?.addEventListener('change', event => cacaPasangLampiran(event.target.files?.[0]));
  cacaEl('cacaLampiranBuang')?.addEventListener('click', () => cacaBuangLampiran());
  cacaEl('cacaFab')?.addEventListener('click', cacaTogglePanel);
  cacaEl('cacaTutup')?.addEventListener('click', cacaTutupPanel);
  cacaEl('cacaPilihGerai')?.addEventListener('click', () => cacaToggleDaftarGerai());

  cacaEl('cacaDaftarGerai')?.addEventListener('click', event => {
    const pilihan = event.target.closest('[data-caca-scope]');
    if (pilihan) cacaGantiGerai(pilihan.dataset.cacaScope);
  });
  cacaEl('cacaDaftarGerai')?.addEventListener('keydown', event => {
    const aktif = document.activeElement?.closest?.('[data-caca-scope]');
    if (!aktif) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      cacaGantiGerai(aktif.dataset.cacaScope);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      (event.key === 'ArrowDown' ? aktif.nextElementSibling : aktif.previousElementSibling)?.focus();
    }
  });

  cacaEl('cacaPercakapan')?.addEventListener('click', event => {
    const saran = event.target.closest('[data-caca-saran]');
    if (!saran) return;
    cacaEl('cacaPertanyaan').value = saran.dataset.cacaSaran;
    cacaKirim();
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.caca-kepala')) cacaToggleDaftarGerai(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const daftar = cacaEl('cacaDaftarGerai');
    if (daftar && !daftar.classList.contains('hidden')) {
      cacaToggleDaftarGerai(false);
      cacaEl('cacaPilihGerai')?.focus();
    } else {
      cacaTutupPanel();
    }
  });
  window.addEventListener('resize', cacaAturTinggiPanel);
}

window.cacaSetTampil = cacaSetTampil;
window.cacaLupakan = cacaLupakan;
document.addEventListener('DOMContentLoaded', initCacaPanel);
