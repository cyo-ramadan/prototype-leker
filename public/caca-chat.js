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

const CACA_MAKS_RIWAYAT = 120;
// 10 pesan Bos yang masih nyambung (Bos Cyo 2026-10-03). Harus sama dengan
// MAKS_PERCAKAPAN di src/caca-riwayat.js.
const CACA_PESAN_NYAMBUNG = 10;

const cacaState = {
  // Ingatan jangka pendek: {dari: 'saya'|'una'|'sistem', teks}. Dikirim 5 pesan
  // Bos terakhir supaya "kalau kemarin?" nyambung; server membersihkannya lagi.
  riwayat: [],
  scope: '',
  stores: [],
  entityName: '',
  lampiran: null,
  // 'menu' | 'rekap': isi foto yang akan dikirim. Bawaannya mengikuti kesiapan
  // gerai: gerai yang belum punya menu hampir pasti mengirim foto daftar menu.
  modeFoto: '',
  // Hasil /api/caca/kesiapan untuk gerai yang sedang dibahas.
  kesiapan: null,
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
      <div class="caca-lampiran-teks">
        <strong>Foto ini isinya…</strong>
        <div class="caca-mode-foto" role="group" aria-label="Isi foto">
          <button type="button" data-caca-mode="menu" aria-pressed="false">🧾 Daftar menu / harga</button>
          <button type="button" data-caca-mode="rekap" aria-pressed="false">📋 Lembar rekap</button>
        </div>
        <span id="cacaLampiranNama"></span>
      </div>
      <button id="cacaLampiranBuang" class="caca-ikon-btn" type="button" aria-label="Batal kirim foto">✕</button>
    </div>
    <form id="cacaTanyaForm" class="caca-ketik">
      <button id="cacaLampirkan" class="caca-ikon-btn caca-tambah" type="button" aria-label="Kirim foto daftar menu atau lembar rekap" title="Kirim foto daftar menu atau lembar rekap">+</button>
      <input id="cacaGambar" type="file" accept="image/*" hidden />
      <textarea id="cacaPertanyaan" rows="1" maxlength="4000" placeholder="Ketik pesan" autocomplete="off"></textarea>
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

function cacaCatatRiwayat(dari, teks) {
  // Jawaban Una boleh lebih panjang (nama barang di tabelnya sering dirujuk lagi).
  const bersih = String(teks ?? '').replace(/\s+/g, ' ').trim().slice(0, dari === 'una' ? 900 : 400);
  if (!bersih) return;
  cacaState.riwayat.push({ dari, teks: bersih });
  if (cacaState.riwayat.length > CACA_MAKS_RIWAYAT) cacaState.riwayat.splice(0, cacaState.riwayat.length - CACA_MAKS_RIWAYAT);
}

// Dari belakang sampai 5 pesan Bos terkumpul; dipanggil SEBELUM pesan sekarang
// dicatat, supaya pesan sekarang tidak terkirim dua kali.
function cacaRiwayatUntukServer() {
  let pesanBos = 0;
  let mulai = 0;
  for (let i = cacaState.riwayat.length - 1; i >= 0; i -= 1) {
    if (cacaState.riwayat[i].dari !== 'saya') continue;
    pesanBos += 1;
    if (pesanBos === CACA_PESAN_NYAMBUNG) { mulai = i; break; }
  }
  return cacaState.riwayat.slice(mulai);
}

// Isi tabel ikut diingat dalam bentuk ringkas: pertanyaan lanjutan seperti
// "yang matcha tadi kenapa?" merujuk nama yang hanya tampil di tabel. Angkanya
// tetap bukan bukti (server menjelaskan itu ke model), cuma pengingat rujukan.
function cacaRingkasTabel(tabel, maks = 400) {
  if (!tabel?.kolom?.length || !tabel.isi?.length) return '';
  const baris = tabel.isi.slice(0, 10).map(r => r.map(sel => String(sel ?? '').trim()).filter(Boolean).join(' | '));
  const lebih = tabel.isi.length > 10 ? ` (+${tabel.isi.length - 10} baris lain)` : '';
  return `[Tabel: ${tabel.kolom.join(' | ')} → ${baris.join('; ')}${lebih}]`.slice(0, maks);
}

function cacaRingkasJawaban(payload) {
  const teks = String(payload.jawaban || '').replace(/\s+/g, ' ').trim().slice(0, 480);
  const tabel = cacaRingkasTabel(payload.tabel);
  return tabel ? `${teks} ${tabel}` : teks;
}

function cacaRingkasDraft(draft) {
  const baris = Array.isArray(draft.baris)
    ? draft.baris.map(([label, nilai]) => `${label}: ${nilai}`).join('; ')
    : `Untuk: ${draft.keterangan}; Nominal: ${draft.nominal}; Ke: ${draft.pihak}; Tanggal: ${draft.tanggal}`;
  const tabel = cacaRingkasTabel(draft.tabel, 360);
  return `Una menyusun draft dan menunggu persetujuan. ${draft.judul || ''} ${baris} ${tabel}`.replace(/\s+/g, ' ').trim();
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
    sessionStorage.setItem(CACA_SIMPANAN, JSON.stringify({ sidik: cacaSidikLogin(), html: salinan.innerHTML, riwayat: cacaState.riwayat }));
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
  cacaState.riwayat = Array.isArray(simpanan.riwayat) ? simpanan.riwayat : [];
  // Rencana yang sedang jalan saat halaman berganti: langkahnya dianggap
  // terputus, supaya Bos bisa melanjutkan dari situ.
  wadah.querySelectorAll('.caca-rencana').forEach(kartu => {
    const rencana = cacaBacaRencana(kartu);
    if (!rencana) return;
    let berubah = false;
    for (const l of rencana.langkah) {
      if (l.status === 'jalan' || l.status === 'menunggu') { l.status = 'gagal'; l.alasan = 'terhenti karena pindah halaman'; berubah = true; }
    }
    if (berubah) cacaRenderRencana(kartu, rencana);
  });
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
  cacaCatatRiwayat('sistem', `Bos pindah membahas ${cacaNamaScope(scope)}.`);
  cacaState.kesiapan = null;
  if (scope === CACA_ENTITY) {
    cacaTambahGelembung('caca', 'Di tingkat entity Una bisa bacain data semua gerai sekaligus dan bikin jurnal entity, mis. "jurnal setoran modal 5jt: debit Bank, kredit Modal Pemilik". Ngisi barang dan nyatet biaya tetap per gerai.');
    return;
  }
  // Gerai yang belum siap jualan langsung ditunjukkan langkahnya; yang sudah
  // siap tidak diganggu kartu apa pun.
  cacaMuatKesiapan(scope).then(hasil => {
    if (scope === cacaState.scope && hasil?.kesiapan && !hasil.kesiapan.siapJualan) cacaTampilkanKesiapan(hasil);
  });
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

// Seperti WhatsApp: selagi Una memproses, subjudul di kepala panel berganti
// "mengetik…" dan gelembungnya bertuliskan "Una sedang mengetik…" (Bos Cyo
// 2026-10-03), bukan tiga titik.
let cacaJumlahMengetik = 0;

function cacaSetStatusMengetik(aktif) {
  const status = cacaEl('cacaStatus');
  if (!status) return;
  cacaJumlahMengetik = Math.max(0, cacaJumlahMengetik + (aktif ? 1 : -1));
  if (cacaJumlahMengetik > 0) {
    if (!status.dataset.asli) status.dataset.asli = status.textContent;
    status.textContent = 'mengetik…';
    status.classList.add('mengetik');
  } else if (status.dataset.asli) {
    status.textContent = status.dataset.asli;
    delete status.dataset.asli;
    status.classList.remove('mengetik');
  }
}

function cacaTambahMengetik() {
  const wadah = cacaEl('cacaPercakapan');
  const gelembung = document.createElement('div');
  gelembung.className = 'caca-gelembung caca mengetik';
  gelembung.setAttribute('aria-label', 'Una sedang mengetik');
  gelembung.innerHTML = '<em class="caca-mengetik-teks">Una sedang mengetik…</em>';
  wadah.appendChild(gelembung);
  cacaGulirKeBawah();
  cacaSetStatusMengetik(true);
  const hapusAsli = gelembung.remove.bind(gelembung);
  let sudah = false;
  gelembung.remove = () => {
    hapusAsli();
    if (!sudah) { sudah = true; cacaSetStatusMengetik(false); }
  };
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

// Tawaran kerjaan yang selalu ada: yang paling sering bikin pemilik baru malas
// (isi menu), yang paling sering ditanya (untung), dan pintu ke daftar kemampuan.
const CACA_TAWARAN_UMUM = [
  { jenis: 'isi', label: '✍️ Masukin daftar menu', teks: 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb' },
  { jenis: 'kirim', label: 'Untung hari ini berapa?', teks: 'untung hari ini berapa?' },
  { jenis: 'jelaskan', label: 'Una bisa bantu apa aja?', topik: 'kemampuan' }
];

const CACA_TAWARAN_ENTITY = [
  { jenis: 'kirim', label: 'Gerai mana yang paling untung bulan ini?', teks: 'gerai mana yang paling untung bulan ini?' },
  { jenis: 'jelaskan', label: 'Una bisa bantu apa aja?', topik: 'kemampuan' }
];

// Sapaan pertama: Una yang membuka percakapan, bukan kotak kosong. Untuk gerai,
// isinya kondisi gerai itu (dihitung server tanpa mesin AI) beserta kerjaan
// berikutnya yang ditawarkan sekali ketuk — UNA-PENDAMPING.md ketakutan #1.
async function cacaSapa() {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah || wadah.childElementCount) return;
  cacaTambahPenanda('Hari ini');
  if (cacaState.scope === CACA_ENTITY) {
    cacaTambahGelembung('caca', `Halo Bos, Una di sini hhe. Ini tingkat ${cacaState.entityName || 'entity'}: Una bisa bacain data semua gerai sekaligus dan bikin jurnal entity. Ngisi barang dan nyatet biaya per gerai — pilih gerainya lewat tombol ▾ di atas.`);
    cacaTambahTawaran(CACA_TAWARAN_ENTITY);
    return;
  }
  const kesiapan = await cacaMuatKesiapan();
  if (kesiapan?.kesiapan && !kesiapan.kesiapan.siapJualan) {
    cacaTampilkanKesiapan(kesiapan, { pembuka: 'Halo Bos, Una di sini.' });
    return;
  }
  cacaTambahGelembung('caca', kesiapan?.sapaan
    ? `Halo Bos, Una di sini hhe. ${kesiapan.sapaan}`
    : 'Halo Bos, Una di sini hhe. Tanya apa aja soal gerai yang dipilih di atas, atau suruh Una ngerjain: ngisi daftar menu, nyatet biaya, bacain foto lembar rekap.');
  const berikutnya = kesiapan?.kesiapan?.langkah?.find(l => l.id === kesiapan.kesiapan.berikutnya);
  cacaTambahTawaran([...(berikutnya?.tawaran || []).slice(0, 1), ...CACA_TAWARAN_UMUM]);
}

// --- kesiapan gerai -----------------------------------------------------------

async function cacaMuatKesiapan(scope = cacaState.scope) {
  if (!scope || scope === CACA_ENTITY) return null;
  try {
    const hasil = await cacaApi(`/api/caca/kesiapan?${cacaQueryLingkup(scope)}`);
    if (scope === cacaState.scope) {
      cacaState.kesiapan = hasil.kesiapan || null;
      cacaAturModeFotoBawaan();
    }
    return hasil;
  } catch {
    // Sapaan biasa tetap muncul; kesiapan cuma bonus, bukan syarat.
    return null;
  }
}

function cacaRenderKesiapan(kesiapan, namaGerai) {
  const persen = kesiapan.total ? Math.round((kesiapan.beres / kesiapan.total) * 100) : 0;
  const tanda = langkah => (langkah.selesai === true ? '✓' : langkah.selesai === false ? '' : '?');
  const kelas = langkah => (langkah.selesai === true ? 'beres' : langkah.selesai === false ? 'belum' : 'tahu');
  return `
    <div class="caca-siap">
      <div class="caca-siap-kepala"><strong>Kesiapan ${cacaEscape(namaGerai)}</strong><span>${kesiapan.beres}/${kesiapan.total}</span></div>
      <div class="caca-siap-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${kesiapan.total}" aria-valuenow="${kesiapan.beres}"><span style="width:${persen}%"></span></div>
      <ul>${kesiapan.langkah.map(l => `
        <li class="${kelas(l)}${l.id === kesiapan.berikutnya ? ' berikutnya' : ''}">
          <span class="caca-siap-tanda" aria-hidden="true">${tanda(l)}</span>
          <span><strong>${cacaEscape(l.judul)}</strong>${l.wajib ? '' : ' <em>anjuran</em>'}${
            // Keterangan anjuran disimpan untuk saat gilirannya tiba: kartu
            // yang terlalu panjang mendorong sapaan Una keluar layar HP.
            l.wajib || l.id === kesiapan.berikutnya ? `<small>${cacaEscape(l.keterangan)}</small>` : ''}</span>
        </li>`).join('')}
      </ul>
    </div>`;
}

function cacaTampilkanKesiapan(payload, { pembuka = '' } = {}) {
  const kesiapan = payload.kesiapan;
  const namaGerai = payload.store?.storeName || cacaNamaScope(cacaState.scope);
  const sapaan = [pembuka, payload.sapaan].filter(Boolean).join(' ');
  const gelembung = cacaTambahGelembung('caca', '', '', { html: `<p>${cacaEscape(sapaan)}</p>${cacaRenderKesiapan(kesiapan, namaGerai)}` });
  const berikutnya = kesiapan.langkah.find(l => l.id === kesiapan.berikutnya);
  cacaTambahTawaran([...(berikutnya?.tawaran || []), { jenis: 'jelaskan', label: 'Una bisa bantu apa aja?', topik: 'kemampuan' }]);
  // Yang dibaca pertama adalah sapaan Una, bukan ekor kartunya.
  const wadah = cacaEl('cacaPercakapan');
  if (wadah && gelembung) wadah.scrollTop += gelembung.getBoundingClientRect().top - wadah.getBoundingClientRect().top - 8;
  cacaCatatRiwayat('una', `Una menampilkan kesiapan ${namaGerai}: ${kesiapan.beres} dari ${kesiapan.total} langkah beres.`);
}

// --- tawaran sekali ketuk -----------------------------------------------------

function cacaTambahTawaran(tawaran) {
  const daftar = (tawaran || []).filter(t => t && t.label);
  if (!daftar.length) return;
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return;
  const baris = document.createElement('div');
  baris.className = 'caca-saran';
  baris.innerHTML = daftar.map(t => `<button type="button" data-caca-tawaran="${cacaEscape(JSON.stringify(t))}">${cacaEscape(t.label)}</button>`).join('');
  wadah.appendChild(baris);
  cacaGulirKeBawah();
  cacaSimpanPercakapan();
}

async function cacaJalankanTawaran(tombol) {
  let t;
  try { t = JSON.parse(tombol.dataset.cacaTawaran || '{}'); } catch { return; }
  const kotak = cacaEl('cacaPertanyaan');
  if (t.jenis === 'isi') {
    // Contoh perintah ditaruh di kotak ketik, bukan langsung dikirim: pemilik
    // tinggal mengganti isinya dengan menu/bahannya sendiri.
    kotak.value = t.teks || '';
    cacaAturTinggiKetik();
    cacaAturTombol();
    kotak.focus();
    kotak.setSelectionRange(kotak.value.length, kotak.value.length);
    return;
  }
  if (t.jenis === 'kirim') {
    if (cacaState.sedangKirim || !cacaState.siap) return;
    kotak.value = t.teks || '';
    cacaKirim();
    return;
  }
  if (t.jenis === 'foto_menu') {
    cacaState.modeFoto = 'menu';
    cacaEl('cacaGambar')?.click();
    return;
  }
  if (t.jenis === 'jelaskan') {
    await cacaJelaskan(t.topik, t.label);
    return;
  }
  if (t.jenis === 'buka') {
    cacaBukaLayar(t.layar);
    return;
  }
  if (t.jenis === 'obrolan') {
    // Pertanyaan santai cukup dijawab sekali: tombol sebarisnya dimatikan.
    tombol.parentElement?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    cacaSimpanPercakapan();
    cacaJawabObrolan(t);
    return;
  }
  if (t.jenis === 'batalkan') {
    tombol.disabled = true;
    await cacaSiapkanBatal(t.id || []);
  }
}

// Penjelasan dari kamus tetap di server — tidak lewat mesin AI, jadi jalan
// walau Una belum tersambung dan tidak bisa mengarang.
async function cacaJelaskan(topik, label) {
  cacaTambahGelembung('saya', label || topik);
  cacaCatatRiwayat('saya', label || topik);
  try {
    const hasil = await cacaApi(`/api/caca/jelaskan?topik=${encodeURIComponent(topik || '')}`);
    cacaTambahGelembung('caca', hasil.jawaban, hasil.judul ? `kamus · ${hasil.judul}` : '');
    cacaCatatRiwayat('una', hasil.jawaban);
    cacaTambahTawaran(hasil.tawaran);
  } catch (error) {
    cacaTambahGelembung('caca', error.message);
  }
}

// --- membukakan layar ---------------------------------------------------------
//
// Untuk kerjaan yang memang tidak lewat chat (akun kasir: ada PIN), Una
// membukakan layarnya — bukan menyuruh mencari sendiri di menu.

const CACA_HASH_BUKA = '#una-buka=';

function cacaKlikTab(layar, sisaCoba = 20) {
  const tombol = document.querySelector(`.admin-tab[data-tab="${CSS.escape(layar)}"]`) || document.querySelector(`[data-tab="${CSS.escape(layar)}"]`);
  if (tombol) {
    tombol.click();
    tombol.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    return true;
  }
  // Tab di workspace dipasang skrip lain saat halaman dimuat; ditunggu sebentar.
  if (sisaCoba > 0) setTimeout(() => cacaKlikTab(layar, sisaCoba - 1), 150);
  return false;
}

function cacaBukaLayar(layar) {
  const gerai = cacaGeraiAktif();
  if (!layar || !gerai) return;
  const geraiHalaman = String(window.LEKER_STORE_CODE || '').toUpperCase();
  if (cacaDiWorkspace() && geraiHalaman === gerai) {
    cacaKlikTab(layar);
    // Di HP panel menutupi layar yang baru dibuka.
    if (window.innerWidth <= 560) cacaTutupPanel();
    return;
  }
  location.href = `/s/${encodeURIComponent(gerai)}/admin${CACA_HASH_BUKA}${encodeURIComponent(layar)}`;
}

function cacaBukaLayarDariHash() {
  if (!cacaDiWorkspace() || !location.hash.startsWith(CACA_HASH_BUKA)) return;
  const layar = decodeURIComponent(location.hash.slice(CACA_HASH_BUKA.length));
  history.replaceState(null, '', location.pathname + location.search);
  if (/^[\w-]{1,40}$/.test(layar)) cacaKlikTab(layar);
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
      : draft.aksi === 'buat_barang_banyak' ? `Ya, masukkan ${draft.muatan?.daftar?.length ?? 0} barang`
      : draft.aksi === 'nonaktifkan_barang' ? 'Ya, nonaktifkan'
      : draft.aksi === 'ubah_barang' ? 'Ya, ubah'
      : draft.aksi === 'hitung_ulang_hpp' ? 'Ya, koreksi HPP'
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

function cacaTampilkanDraft(payload, scope, { sesudah = null } = {}) {
  const draft = payload.draft;
  const tampilan = cacaIsiDraft(draft);
  // Ketakutan nomor tiga pemilik baru: "takut salah terus rusak". Draft
  // pertama di percakapan bilang terang bahwa belum ada yang tersimpan.
  const pertama = !cacaEl('cacaPercakapan')?.querySelector('.caca-draft');
  const html = `
    <div class="caca-draft">
      <div class="caca-draft-judul">${cacaEscape(tampilan.judul)}</div>
      ${tampilan.isi}
      <ul class="caca-draft-dampak">${draft.dampak.map(d => `<li>${cacaEscape(d)}</li>`).join('')}</ul>
      ${pertama ? '<p class="caca-draft-tenang">Tenang, belum ada yang tersimpan sebelum Bos tekan tombol hijau.</p>' : ''}
      <div class="caca-draft-aksi">
        <button class="primary-btn" type="button" data-caca-catat>${cacaEscape(tampilan.tombol)}</button>
        <button class="secondary-btn" type="button" data-caca-batal>Batal</button>
      </div>
    </div>`;
  const gelembung = cacaTambahGelembung('caca', '', '', { html });
  const kartu = gelembung.querySelector('.caca-draft');
  kartu._cacaSesudah = sesudah;
  const kunci = () => kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });

  kartu.querySelector('[data-caca-batal]').addEventListener('click', () => {
    kunci();
    kartu.classList.add('dibatalkan');
    cacaCatatRiwayat('sistem', 'Bos membatalkan draft itu.');
    cacaSimpanPercakapan();
    cacaTambahGelembung('caca', 'Oke, gajadi deh.');
    kartu._cacaSesudah?.('batal');
  });

  // Gerai/lingkup diambil dari saat draft dibuat, bukan dari judul sekarang:
  // kalau Bos sempat ganti gerai sebelum menekan "Ya", hasilnya tetap masuk ke
  // tempat yang tertulis di draft.
  kartu.querySelector('[data-caca-catat]').addEventListener('click', async () => {
    kunci();
    if (draft.bertahap) {
      await cacaJalankanBertahap(kartu, draft, scope, 0);
      return;
    }
    try {
      const hasil = await cacaApi(`/api/caca/catat?${cacaQueryLingkup(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ draft })
      });
      kartu.classList.add('tercatat');
      cacaCatatRiwayat('sistem', `Bos menyetujui draft itu dan sudah dijalankan. ${hasil.jawaban || ''}`);
      cacaSimpanPercakapan();
      cacaTambahGelembung('caca', hasil.jawaban);
      if (draft.aksi === 'buat_barang') cacaObrolanSesudahBarang(draft, [draft.muatan?.name].filter(Boolean));
      kartu._cacaSesudah?.('tercatat');
    } catch (error) {
      // Tombol dibuka lagi: yang gagal biasanya bisa diulang setelah sebabnya
      // dibereskan, dan menguncinya permanen memaksa mengetik ulang dari awal.
      kartu.querySelectorAll('button').forEach(b => { b.disabled = false; });
      cacaTambahGelembung('caca', error.message);
    }
  });
}

// --- draft bertahap -----------------------------------------------------------
//
// Isi barang massal dan batalkan barang dikirim satu baris per permintaan
// (paket Cloudflare gratis membatasi kerja per permintaan; lihat
// src/caca-aksi-barang.js). Panel yang mengulang, dan pemilik melihat
// hitungannya jalan. Yang gagal di tengah bisa dilanjutkan dari baris itu.

async function cacaJalankanBertahap(kartu, draft, scope, mulai) {
  const daftar = draft.muatan?.daftar || [];
  const jumlah = daftar.length;
  let kemajuan = kartu.querySelector('.caca-kemajuan');
  if (!kemajuan) {
    kemajuan = document.createElement('div');
    kemajuan.className = 'caca-kemajuan';
    kemajuan.innerHTML = '<div class="caca-kemajuan-bar"><span></span></div><p class="caca-kemajuan-teks"></p>';
    kartu.querySelector('.caca-draft-aksi').before(kemajuan);
  }
  kartu.querySelector('[data-caca-lanjut]')?.remove();
  const isiBar = kemajuan.querySelector('span');
  const teks = kemajuan.querySelector('.caca-kemajuan-teks');
  const hasil = JSON.parse(kartu.dataset.cacaHasil || '[]');

  for (let i = mulai; i < jumlah; i += 1) {
    teks.textContent = `${i + 1} dari ${jumlah} · ${daftar[i].name}`;
    isiBar.style.width = `${Math.round((i / jumlah) * 100)}%`;
    try {
      const balasan = await cacaApi(`/api/caca/catat?${cacaQueryLingkup(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ draft, bagian: i })
      });
      hasil[i] = { hasil: balasan.hasil, nama: balasan.nama, id: balasan.id };
      kartu.dataset.cacaHasil = JSON.stringify(hasil);
    } catch (error) {
      teks.textContent = `Berhenti di ${i + 1} dari ${jumlah} (${daftar[i].name}): ${error.message}`;
      const lanjut = document.createElement('button');
      lanjut.type = 'button';
      lanjut.className = 'secondary-btn';
      lanjut.dataset.cacaLanjut = '';
      lanjut.textContent = `Lanjutkan dari ${daftar[i].name}`;
      lanjut.addEventListener('click', () => cacaJalankanBertahap(kartu, draft, scope, i));
      kemajuan.after(lanjut);
      cacaSimpanPercakapan();
      return;
    }
  }

  isiBar.style.width = '100%';
  kartu.classList.add('tercatat');
  const selesai = hasil.filter(Boolean);
  // Rencana bertahap menunggu draft ini selesai sebelum lanjut ke langkah berikutnya.
  setTimeout(() => kartu._cacaSesudah?.('tercatat'), 0);
  if (draft.aksi === 'buat_barang_banyak') {
    const dibuat = selesai.filter(h => h.hasil === 'dibuat');
    const sudahAda = selesai.filter(h => h.hasil === 'sudah_ada');
    teks.textContent = `Selesai: ${dibuat.length} barang masuk${sudahAda.length ? `, ${sudahAda.length} ternyata sudah ada` : ''}.`;
    cacaCatatRiwayat('sistem', `Bos menyetujui; Una membuat ${dibuat.length} barang: ${dibuat.map(h => h.nama).join(', ')}.`);
    cacaSimpanPercakapan();
    const ids = dibuat.map(h => h.id).filter(Boolean);
    const tawaran = ids.length ? [{ jenis: 'batalkan', label: '↩️ Batalkan yang barusan', id: ids }] : [];
    // Langkah berikutnya langsung ditawarkan: pemilik tidak perlu memikirkan
    // "habis ini ngapain".
    const kesiapan = await cacaMuatKesiapan(scope);
    const berikutnya = kesiapan?.kesiapan?.langkah?.find(l => l.id === kesiapan.kesiapan.berikutnya);
    const lanjut = berikutnya && berikutnya.id !== 'menu' ? berikutnya : null;
    cacaTambahGelembung('caca', [
      dibuat.length
        ? `Beres, Bos! ${dibuat.length} barang sudah masuk daftar${sudahAda.length ? ` (${sudahAda.length} ternyata sudah ada, Una lewati)` : ''}. Langsung muncul di kasir.`
        : 'Semua barang di daftar itu ternyata sudah ada, jadi tidak ada yang Una tambah.',
      lanjut ? `Langkah berikutnya: ${lanjut.judul.toLowerCase()} — ${lanjut.keterangan.charAt(0).toLowerCase()}${lanjut.keterangan.slice(1)}` : ''
    ].filter(Boolean).join('\n'));
    cacaTambahTawaran([...tawaran, ...(lanjut?.tawaran || [])]);
    cacaObrolanSesudahBarang(draft, dibuat.map(h => h.nama));
    return;
  }
  if (draft.aksi === 'ubah_barang') {
    const diubah = selesai.filter(h => h.hasil === 'diubah');
    teks.textContent = `Selesai: ${diubah.length} barang diubah.`;
    cacaCatatRiwayat('sistem', `Bos menyetujui; Una mengubah ${diubah.length} barang: ${diubah.map(h => h.nama).join(', ')}.`);
    cacaSimpanPercakapan();
    const gerai = cacaNamaScope(scope);
    cacaTambahGelembung('caca', diubah.length === 1
      ? `Beres, ${diubah[0].nama} di Data Barang ${gerai} sudah Una ubah. Langsung berlaku di kasir ${gerai}.`
      : `Beres, ${diubah.length} barang di Data Barang ${gerai} sudah Una ubah. Langsung berlaku di kasir ${gerai}.`);
    return;
  }
  const dinonaktifkan = selesai.filter(h => h.hasil === 'dinonaktifkan');
  teks.textContent = `Selesai: ${dinonaktifkan.length} barang dinonaktifkan.`;
  cacaCatatRiwayat('sistem', `Bos menyetujui; Una menonaktifkan ${dinonaktifkan.length} barang: ${dinonaktifkan.map(h => h.nama).join(', ')}.`);
  cacaSimpanPercakapan();
  cacaTambahGelembung('caca', dinonaktifkan.length
    ? `Sudah Una nonaktifkan ${dinonaktifkan.length} barang. Riwayatnya tetap aman, dan bisa diaktifkan lagi di Data Barang.`
    : 'Barang-barang itu ternyata sudah nonaktif semua.');
}

// --- obrolan santai sesudah barang jadi ---------------------------------------
//
// Bos Cyo 2026-10-02: barang cukup nama + harga, detail lain diisi yang dasar
// tanpa ditanya. Sesudah beres baru ngobrol santai: "dibikin dulu atau langsung
// jadi?" — jawabannya menggiring ke resep (dibikin) atau ke mencatat kulakan
// di kasir (beli jadi). Hanya ditanyakan untuk barang jualan yang modalnya
// belum disebut; kalimatnya tetap, tidak lewat mesin AI.

const CACA_PEMBUKA_SANTAI = ['Mantap, daftar jualannya makin rame hhe.', 'Sip, kasir udah bisa jualan itu.', 'Oke beres. Pelan-pelan kita rapiin bareng ya.'];

function cacaObrolanSesudahBarang(draft, namaDibuat) {
  if (!namaDibuat.length || draft.tangkapan?.daftar_jenis === 'bahan') return;
  const baris = draft.aksi === 'buat_barang' ? [draft.muatan] : (draft.muatan?.daftar || []);
  const tanpaModal = baris.filter(b => b && !b.purchasePrice && namaDibuat.includes(b.name)).map(b => b.name);
  if (!tanpaModal.length) return;
  const sebut = tanpaModal.length === 1 ? tanpaModal[0] : `${tanpaModal[0]} dan yang lain`;
  const pembuka = CACA_PEMBUKA_SANTAI[Math.floor(Math.random() * CACA_PEMBUKA_SANTAI.length)];
  cacaTambahGelembung('caca', `${pembuka} Ngomong-ngomong, kalau boleh tau nih Bos — ${sebut} itu dibikin sendiri dulu, atau belinya udah langsung jadi?`);
  cacaCatatRiwayat('una', `Una bertanya apakah ${sebut} dibikin sendiri atau dibeli jadi.`);
  cacaTambahTawaran([
    { jenis: 'obrolan', kunci: 'dibikin', label: '🍳 Dibikin sendiri', barang: tanpaModal[0] },
    { jenis: 'obrolan', kunci: 'dibeli', label: '🛒 Beli udah jadi', barang: tanpaModal[0] },
    { jenis: 'obrolan', kunci: 'nanti', label: 'Nanti aja' }
  ]);
}

function cacaJawabObrolan(t) {
  cacaTambahGelembung('saya', t.label.replace(/^\W+\s*/u, ''));
  cacaCatatRiwayat('saya', t.label);
  if (t.kunci === 'dibikin') {
    const jumlah = cacaState.kesiapan?.langkah?.find(l => l.id === 'resep')?.jumlah;
    const barang = t.barang || 'menunya';
    cacaTambahGelembung('caca', `Wah racikan sendiri, mantep hhe. Biar untung tiap porsi ${barang} kebaca pas, kita catat resepnya yuk — cukup sebut bahannya sama kira-kira takarannya, nggak harus presisi dulu. Nanti tiap kali kejual, stok bahannya ikut berkurang sendiri.`);
    cacaCatatRiwayat('una', 'Una menawarkan membuat resep.');
    cacaTambahTawaran(jumlah?.bahan
      ? [
          { jenis: 'isi', label: '✍️ Bikin resepnya', teks: `resep ${barang}: hasil 1, ` },
          { jenis: 'jelaskan', topik: 'resep', label: 'Resep itu gunanya apa?' }
        ]
      : [
          { jenis: 'isi', label: '✍️ Masukin bahannya dulu', teks: 'masukin bahan: Gula pasir (gram), Teh (gram), Susu kental manis (ml)' },
          { jenis: 'jelaskan', topik: 'resep', label: 'Resep itu gunanya apa?' }
        ]);
    return;
  }
  if (t.kunci === 'dibeli') {
    cacaTambahGelembung('caca', 'Sip, berarti tinggal kulakan aja ya. Nanti tiap belanja barangnya dicatat di Kasir, modalnya kebaca sendiri — jadi untungnya pas tanpa Bos ngitung manual.');
    cacaCatatRiwayat('una', 'Una menjelaskan modal terbaca dari pembelian di kasir.');
    cacaTambahTawaran([{ jenis: 'jelaskan', topik: 'hpp', label: 'Modal (HPP) itu dihitung gimana?' }]);
    return;
  }
  cacaTambahGelembung('caca', 'Oke santai, kapan-kapan aja hhe. Una di sini kalau butuh.');
}

// "Batalkan yang barusan": draft nonaktifkan disusun dari id barang yang tadi
// dibuat, tanpa mesin AI. Tetap lewat kartu draft + "Ya".
async function cacaSiapkanBatal(ids) {
  if (!cacaCekGerai()) return;
  const scope = cacaState.scope;
  cacaTambahGelembung('saya', 'Batalkan yang barusan');
  cacaCatatRiwayat('saya', 'Batalkan barang yang barusan dibuat.');
  const mengetik = cacaTambahMengetik();
  try {
    const payload = await cacaApi(`/api/caca/siapkan?${cacaQueryLingkup(scope)}`, {
      method: 'POST',
      body: JSON.stringify({ aksi: 'nonaktifkan_barang', tangkapan: { nonaktif_id: ids } })
    });
    mengetik.remove();
    if (payload.draft) cacaTampilkanDraft(payload, scope);
    else cacaTambahGelembung('caca', payload.jawaban);
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
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
  if (payload.jejak) return payload.jejak;
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

// Gerai yang belum punya menu hampir pasti sedang mengirim foto daftar menu;
// gerai yang sudah jalan biasanya mengirim lembar rekap harian.
function cacaAturModeFotoBawaan() {
  const menu = cacaState.kesiapan?.langkah?.find(l => l.id === 'menu');
  if (!cacaState.lampiran) cacaState.modeFoto = menu?.selesai === false ? 'menu' : '';
}

function cacaPilihModeFoto(mode) {
  cacaState.modeFoto = mode === 'menu' ? 'menu' : 'rekap';
  document.querySelectorAll('[data-caca-mode]').forEach(tombol => {
    tombol.setAttribute('aria-pressed', String(tombol.dataset.cacaMode === cacaState.modeFoto));
  });
  const kotak = cacaEl('cacaPertanyaan');
  if (kotak && cacaState.lampiran) {
    kotak.placeholder = cacaState.modeFoto === 'menu' ? 'Kirim, Una masukin menunya' : 'Kirim, Una bacain rekapnya';
  }
}

function cacaPasangLampiran(file) {
  const mode = cacaState.modeFoto;
  cacaBuangLampiran();
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    cacaTambahGelembung('caca', 'Yang bisa Una baca baru foto (gambar): daftar menu/harga atau lembar rekap.');
    return;
  }
  cacaState.lampiran = { file, url: URL.createObjectURL(file) };
  cacaEl('cacaLampiranGambar').src = cacaState.lampiran.url;
  cacaEl('cacaLampiranNama').textContent = file.name;
  cacaEl('cacaLampiran').classList.remove('hidden');
  cacaPilihModeFoto(mode || 'rekap');
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
  cacaAturModeFotoBawaan();
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
  const mode = cacaState.modeFoto === 'menu' ? 'menu' : 'rekap';
  cacaBuangLampiran({ terkirim: true });
  const nama = mode === 'menu' ? 'Foto daftar menu' : 'Foto lembar rekap';
  cacaTambahGelembung('saya', '', '', { html: `<img class="caca-foto" src="${cacaEscape(url)}" alt="${nama}" />` });
  cacaCatatRiwayat('saya', `Bos mengirim ${nama.toLowerCase()}.`);
  if (!cacaCekGerai()) return;
  if (mode === 'menu') {
    await cacaKirimFotoMenu(file);
    return;
  }

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
    cacaCatatRiwayat('una', `Una membaca lembar rekap tanggal ${payload.hasil?.tanggal_tertulis || '(tidak terbaca)'}; hasilnya ditampilkan di layar.`);
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

// Foto papan menu → draft isi barang massal (server: /api/caca/baca-menu).
async function cacaKirimFotoMenu(file) {
  const scope = cacaState.scope;
  const mengetik = cacaTambahMengetik();
  try {
    const gambar = await cacaBacaBerkas(file);
    const payload = await cacaApi(`/api/caca/baca-menu?${cacaQueryLingkup(scope)}`, {
      method: 'POST',
      body: JSON.stringify({ gambar })
    });
    mengetik.remove();
    if (payload.perluKonfirmasi && payload.draft) {
      cacaCatatRiwayat('una', cacaRingkasDraft(payload.draft));
      if (payload.sapaan) cacaTambahGelembung('caca', payload.sapaan);
      cacaTampilkanDraft(payload, scope);
    } else {
      cacaCatatRiwayat('una', payload.jawaban || '');
      cacaTambahGelembung('caca', payload.jawaban);
    }
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

// Satu pesan ke Una (dipakai pesan biasa dan tiap langkah rencana).
async function cacaTanyaServer(pertanyaan, scope, riwayat) {
  return cacaApi(`/api/caca/tanya?${cacaQueryLingkup(scope)}`, {
    method: 'POST',
    body: JSON.stringify({ pertanyaan, riwayat })
  });
}

/**
 * Menampilkan balasan Una. Mengembalikan jenisnya: 'draft' (menunggu "Ya"),
 * 'tanya' (Una balik bertanya / belum bisa), 'rencana', atau 'jawab'.
 * `sesudahDraft(status)` dipanggil saat draft dijalankan ('tercatat') atau
 * dibatalkan ('batal') — dipakai rencana untuk lanjut ke langkah berikutnya.
 */
function cacaTampilkanBalasan(payload, scope, { sesudahDraft = null } = {}) {
  cacaCatatRiwayat('una', payload.perluKonfirmasi && payload.draft
    ? cacaRingkasDraft(payload.draft)
    : `${cacaRingkasJawaban(payload)}${payload.rencana ? ` Rencana: ${payload.rencana.map((l, i) => `${i + 1}. ${l.judul}`).join('; ')}` : ''}`);
  if (payload.perluKonfirmasi && payload.draft) {
    // Pengantar santai (mis. "Peh, banyak juga ini") selalu di luar kartu
    // draft — isi draft dicocokkan ulang huruf per huruf saat "Ya".
    if (payload.sapaan) cacaTambahGelembung('caca', payload.sapaan);
    cacaTampilkanDraft(payload, scope, { sesudah: sesudahDraft });
    return 'draft';
  }
  // Jejak alat sengaja ditampilkan: angka yang muncul harus bisa ditelusuri
  // asalnya, bukan diterima begitu saja karena keluar dari mulut Una.
  const tabel = cacaRenderTabel(payload.tabel);
  const peringatan = payload.peringatan ? `<p class="caca-peringatan">${cacaEscape(payload.peringatan)}</p>` : '';
  if (tabel || peringatan) {
    // Kalimatnya di atas tabel, bukan di bawahnya.
    cacaTambahGelembung('caca', '', cacaJejakAlat(payload), { html: `<p>${cacaEscape(payload.jawaban)}</p>${tabel}${peringatan}` });
  } else {
    cacaTambahGelembung('caca', payload.jawaban, cacaJejakAlat(payload));
  }
  cacaTambahTawaran(payload.tawaran);
  if (payload.rencana) return 'rencana';
  return payload.belumLengkap ? 'tanya' : 'jawab';
}

async function cacaKirimTeks(pertanyaan) {
  const riwayat = cacaRiwayatUntukServer();
  cacaTambahGelembung('saya', pertanyaan);
  cacaCatatRiwayat('saya', pertanyaan);
  if (!cacaCekGerai({ bolehEntity: true })) return;

  const scope = cacaState.scope;
  const mengetik = cacaTambahMengetik();
  try {
    const payload = await cacaTanyaServer(pertanyaan, scope, riwayat);
    mengetik.remove();
    const jenis = cacaTampilkanBalasan(payload, scope);
    if (jenis === 'rencana') await cacaMulaiRencana(payload.rencana, scope);
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

// --- rencana bertahap ----------------------------------------------------------
//
// Bos Cyo 2026-10-03: perintah berurutan ("cek harga yang anomali, lalu ganti
// dengan harga normal") ditulis dulu sebagai langkah — 1. … ✓, 2. … (jalan),
// 3. … — lalu dikerjakan satu per satu. Tiap langkah dikirim sebagai pesan
// biasa, jadi tetap lewat pilih-alat, draft, dan "Ya" yang sama; rencana tidak
// membuka jalan pintas. Kalau satu langkah putus (RTO, koneksi), langkah
// sebelumnya tetap beres dan Bos bisa melanjutkan dari langkah itu. Keadaan
// rencana disimpan di kartunya sendiri (data-caca-rencana), jadi tombol
// "Lanjutkan" tetap bekerja sesudah pindah halaman.

const CACA_STATUS_RENCANA = {
  antri: { tanda: '', label: '' },
  jalan: { tanda: '…', label: 'lagi dikerjakan' },
  selesai: { tanda: '✓', label: '' },
  menunggu: { tanda: '⏸', label: 'menunggu "Ya" dari Bos' },
  tanya: { tanda: '?', label: 'menunggu jawaban Bos' },
  batal: { tanda: '✕', label: 'dibatalkan' },
  gagal: { tanda: '⚠', label: 'terputus' }
};

function cacaBacaRencana(kartu) {
  try { return JSON.parse(kartu.dataset.cacaRencana || 'null'); } catch { return null; }
}

function cacaRenderRencana(kartu, rencana) {
  kartu.dataset.cacaRencana = JSON.stringify(rencana);
  // Tombol hanya muncul kalau rencana berhenti: ulangi langkah yang terputus,
  // atau lanjut ke langkah sesudah yang menunggu jawaban/dibatalkan.
  const henti = rencana.langkah.findIndex(l => ['tanya', 'batal', 'gagal'].includes(l.status));
  let tombol = '';
  if (henti >= 0 && rencana.langkah[henti].status === 'gagal') {
    tombol = `<button type="button" class="secondary-btn" data-caca-rencana-lanjut="${henti}">Ulangi langkah ${henti + 1}</button>`;
  } else if (henti >= 0 && henti + 1 < rencana.langkah.length) {
    tombol = `<button type="button" class="secondary-btn" data-caca-rencana-lanjut="${henti + 1}">Lanjutkan ke langkah ${henti + 2}</button>`;
  }
  const selesaiSemua = rencana.langkah.every(l => l.status === 'selesai');
  kartu.innerHTML = `
    <div class="caca-rencana-judul">${selesaiSemua ? 'Rencana Una — beres ✓' : 'Rencana Una'}</div>
    <ol>${rencana.langkah.map((l, i) => {
      const st = CACA_STATUS_RENCANA[l.status] || CACA_STATUS_RENCANA.antri;
      return `<li class="${cacaEscape(l.status)}"><span class="caca-rencana-teks">${i + 1}. ${cacaEscape(l.judul)}</span>${
        st.tanda ? ` <span class="caca-rencana-tanda">${st.tanda}</span>` : ''}${
        st.label ? ` <small>${cacaEscape(st.label)}</small>` : ''}${
        l.status === 'gagal' && l.alasan ? `<small class="caca-rencana-alasan">${cacaEscape(l.alasan)}</small>` : ''}</li>`;
    }).join('')}</ol>
    ${tombol ? `<div class="caca-rencana-aksi">${tombol}</div>` : ''}`;
  cacaSimpanPercakapan();
}

async function cacaMulaiRencana(langkah, scope) {
  const gelembung = cacaTambahGelembung('caca', '', '', { html: '<div class="caca-rencana"></div>' });
  const kartu = gelembung.querySelector('.caca-rencana');
  cacaRenderRencana(kartu, { scope, langkah: langkah.map(l => ({ judul: l.judul, perintah: l.perintah, status: 'antri' })) });
  await cacaJalankanRencana(kartu, 0);
}

async function cacaJalankanRencana(kartu, mulai) {
  const rencana = cacaBacaRencana(kartu);
  if (!rencana) return;
  kartu.querySelector('.caca-rencana-aksi')?.remove();
  for (let i = mulai; i < rencana.langkah.length; i += 1) {
    const langkah = rencana.langkah[i];
    langkah.status = 'jalan';
    delete langkah.alasan;
    cacaRenderRencana(kartu, rencana);
    const riwayat = cacaRiwayatUntukServer();
    cacaCatatRiwayat('saya', `(Langkah ${i + 1} dari rencana) ${langkah.perintah}`);
    const mengetik = cacaTambahMengetik();
    let payload;
    try {
      payload = await cacaTanyaServer(langkah.perintah, rencana.scope, riwayat);
    } catch (error) {
      mengetik.remove();
      langkah.status = 'gagal';
      langkah.alasan = error.message;
      cacaRenderRencana(kartu, rencana);
      cacaCatatRiwayat('sistem', `Langkah ${i + 1} terputus: ${error.message}`);
      return;
    }
    mengetik.remove();
    const jenis = cacaTampilkanBalasan({ ...payload, rencana: null }, rencana.scope, {
      sesudahDraft: status => {
        const kini = cacaBacaRencana(kartu);
        if (!kini) return;
        kini.langkah[i].status = status === 'tercatat' ? 'selesai' : 'batal';
        cacaRenderRencana(kartu, kini);
        if (status === 'tercatat') cacaJalankanRencana(kartu, i + 1);
      }
    });
    if (jenis === 'draft') {
      langkah.status = 'menunggu';
      cacaRenderRencana(kartu, rencana);
      return; // dilanjutkan oleh sesudahDraft
    }
    if (jenis === 'tanya') {
      // Una butuh jawaban (mis. harga normal berapa). Bos menjawab di chat,
      // lalu menekan "Lanjutkan" di kartu ini.
      langkah.status = 'tanya';
      cacaRenderRencana(kartu, rencana);
      return;
    }
    langkah.status = 'selesai';
    cacaRenderRencana(kartu, rencana);
  }
  cacaTambahGelembung('caca', 'Semua langkah beres, Bos hhe.');
}

// Kotak ketik tumbuh mengikuti isinya (daftar menu yang ditempel bisa
// puluhan baris), sampai batas tertentu lalu bergulir — seperti WhatsApp.
function cacaAturTinggiKetik() {
  const kotak = cacaEl('cacaPertanyaan');
  if (!kotak) return;
  kotak.style.height = 'auto';
  kotak.style.height = `${Math.min(kotak.scrollHeight, 140)}px`;
}

async function cacaKirim(event) {
  event?.preventDefault();
  if (cacaState.sedangKirim || !cacaState.siap) return;
  const input = cacaEl('cacaPertanyaan');
  const teks = input.value.trim();
  if (!cacaState.lampiran && !teks) return;

  cacaState.sedangKirim = true;
  cacaAturTombol();
  try {
    if (cacaState.lampiran) {
      await cacaKirimFoto();
    } else {
      input.value = '';
      cacaAturTinggiKetik();
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
  cacaState.riwayat = [];
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
  if (cacaEl('cacaPercakapan')?.childElementCount) {
    // Percakapan dipulihkan dari halaman sebelumnya: kesiapan tetap dibaca
    // supaya pilihan bawaan foto (menu/rekap) mengikuti kondisi gerai.
    cacaMuatKesiapan();
  } else {
    await cacaSapa();
  }
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
  cacaBukaLayarDariHash();

  cacaEl('cacaTanyaForm')?.addEventListener('submit', cacaKirim);
  cacaEl('cacaPertanyaan')?.addEventListener('input', () => { cacaAturTinggiKetik(); cacaAturTombol(); });
  // Enter mengirim, Shift+Enter baris baru. Saat mengetik dengan IME (mis.
  // keyboard HP yang sedang menyusun kata), Enter milik IME tidak mengirim.
  cacaEl('cacaPertanyaan')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      cacaKirim();
    }
  });
  cacaEl('cacaLampirkan')?.addEventListener('click', () => cacaEl('cacaGambar')?.click());
  cacaEl('cacaLampiran')?.addEventListener('click', event => {
    const tombol = event.target.closest('[data-caca-mode]');
    if (tombol) cacaPilihModeFoto(tombol.dataset.cacaMode);
  });
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
    const lanjut = event.target.closest('[data-caca-rencana-lanjut]');
    if (lanjut && !lanjut.disabled) {
      const kartu = lanjut.closest('.caca-rencana');
      if (kartu && !cacaState.sedangKirim) {
        lanjut.disabled = true;
        cacaState.sedangKirim = true;
        cacaAturTombol();
        cacaJalankanRencana(kartu, Number(lanjut.dataset.cacaRencanaLanjut) || 0).finally(() => {
          cacaState.sedangKirim = false;
          cacaAturTombol();
        });
      }
      return;
    }
    const tawaran = event.target.closest('[data-caca-tawaran]');
    if (tawaran && !tawaran.disabled) {
      cacaJalankanTawaran(tawaran);
      return;
    }
    // Saran versi lama yang masih tersimpan di percakapan sebelum pembaruan ini.
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
