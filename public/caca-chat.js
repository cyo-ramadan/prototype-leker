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

// Bos Cyo 2026-10-05: batas "10 chat terakhir" dibuang. Seluruh obrolan sesi
// dikirim sampai anggaran huruf yang sama dengan server (MAKS_TOTAL_RIWAYAT di
// src/caca-riwayat.js); server tetap membersihkan dan memotongnya sendiri.
const CACA_MAKS_RIWAYAT = 400;
const CACA_ANGGARAN_RIWAYAT = 60000;
const CACA_PANJANG_ENTRI = 4000;

const cacaState = {
  // Ingatan jangka pendek: {dari: 'saya'|'una'|'sistem', teks}. Dikirim 5 pesan
  // Bos terakhir supaya "kalau kemarin?" nyambung; server membersihkannya lagi.
  riwayat: [],
  kerjaTertunda: null,
  tertunda: null,
  ngambekSampai: 0,
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
  // Giliran percakapan aktif (U4 Una Live): mengikat konteks lembar dan uiActions.
  turnId: null,
  konteksLembar: null,
  siap: false,
  siapDipakai: false,
  // Persona yang diajak bicara (src/agen-persona.js). Una = bawaan, perilaku lama.
  agen: 'una',
  // [{id, nama, peran}] dari /api/caca/pengaturan: hanya yang diizinkan dan aktif.
  daftarAgen: [],
  // Mode Analisis (Claude Sonnet): tersedia bila Owner mengizinkan tenant & kunci terpasang.
  // Sekali pakai: menyala untuk satu pesan (termasuk putaran lanjutannya), lalu mati sendiri.
  analisisTersedia: false,
  analisis: false,
  analisisGiliran: false
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
  if (!response.ok) throw Object.assign(new Error(payload.error || `Permintaan gagal (${response.status})`), { status: response.status, code: payload.code, payload });
  if ((localStorage.getItem('lekerEntityAdminToken') || '') !== token) throw new Error('Sesi Una berubah. Buka kembali setelah login.');
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
      <button id="cacaMulutToggle" class="caca-ikon-btn caca-mulut hidden" type="button" aria-pressed="false" aria-label="Una bicara" title="Bacakan balasan">🔊</button>
      <button id="cacaMulutStop" class="caca-ikon-btn caca-mulut hidden" type="button" aria-label="Hentikan pembacaan" title="Hentikan pembacaan">■</button>
      <button id="cacaWorkspaceToggle" class="secondary-btn caca-workspace-toggle" type="button" aria-expanded="false" aria-controls="cacaWorkspace">Workspace</button>
      <button id="cacaTutup" class="caca-ikon-btn" type="button" aria-label="Tutup Una">✕</button>
      <ul id="cacaDaftarGerai" class="caca-daftar-gerai hidden" role="listbox" aria-label="Pilih gerai yang dibahas"></ul>
    </div>
    <div id="cacaPilihAgen" class="caca-pilih-agen hidden" role="tablist" aria-label="Pilih asisten"></div>
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
      <textarea id="cacaPertanyaan" rows="1" placeholder="Ketik pesan" autocomplete="off"></textarea>
      <button id="cacaMikrofon" class="caca-ikon-btn caca-mikrofon" type="button" aria-label="Mulai bicara" aria-pressed="false" aria-describedby="cacaSuaraStatus" title="Beri tugas lewat suara"><svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-5-3H5a7 7 0 0 0 6 6.93V22h2v-3.07A7 7 0 0 0 19 12h-2a5 5 0 0 1-10 0Z"/></svg></button>
      <button id="cacaLiveToggle" class="caca-ikon-btn caca-live-toggle" type="button" aria-label="Mulai obrolan live" aria-pressed="false" aria-describedby="cacaSuaraStatus" title="Mulai obrolan live">☎</button>
      <button id="cacaAnalisis" class="caca-ikon-btn caca-analisis hidden" type="button" aria-pressed="false" aria-label="Analisis dengan Claude Sonnet untuk pesan berikutnya" title="Analisis (Claude Sonnet) untuk pesan berikutnya">🔬</button>
      <button id="cacaTanyaKirim" class="caca-kirim" type="submit" aria-label="Kirim" disabled>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.1 15 12 3.4 13.9z"/></svg>
      </button>
    </form>
    <div id="cacaSuaraStatus" class="caca-suara-status" role="status" aria-live="polite"></div>
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
  const bersih = String(teks ?? '').replace(/\s+/g, ' ').trim().slice(0, CACA_PANJANG_ENTRI);
  if (!bersih) return;
  cacaState.riwayat.push({ dari, teks: bersih });
  if (cacaState.riwayat.length > CACA_MAKS_RIWAYAT) cacaState.riwayat.splice(0, cacaState.riwayat.length - CACA_MAKS_RIWAYAT);
}

// Dari belakang sampai anggaran huruf habis; dipanggil SEBELUM pesan sekarang
// dicatat, supaya pesan sekarang tidak terkirim dua kali.
function cacaRiwayatUntukServer() {
  let total = 0;
  let mulai = cacaState.riwayat.length;
  for (let i = cacaState.riwayat.length - 1; i >= 0; i -= 1) {
    total += cacaState.riwayat[i].teks.length;
    if (total > CACA_ANGGARAN_RIWAYAT) break;
    mulai = i;
  }
  return cacaState.riwayat.slice(mulai);
}

// Isi tabel ikut diingat dalam bentuk ringkas: pertanyaan lanjutan seperti
// "yang matcha tadi kenapa?" merujuk nama yang hanya tampil di tabel. Angkanya
// tetap bukan bukti (server menjelaskan itu ke model), cuma pengingat rujukan.
function cacaRingkasTabel(tabel, maks = 2500) {
  if (!tabel?.kolom?.length || !tabel.isi?.length) return '';
  const baris = tabel.isi.slice(0, 40).map(r => r.map(sel => String(sel ?? '').trim()).filter(Boolean).join(' | '));
  const lebih = tabel.isi.length > 40 ? ` (+${tabel.isi.length - 40} baris lain)` : '';
  return `[Tabel: ${tabel.kolom.join(' | ')} → ${baris.join('; ')}${lebih}]`.slice(0, maks);
}

function cacaRingkasJawaban(payload) {
  const teks = String(payload.jawaban || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const tabel = cacaRingkasTabel(payload.tabel);
  return tabel ? `${teks} ${tabel}` : teks;
}

function cacaRingkasDraft(draft) {
  const baris = Array.isArray(draft.baris)
    ? draft.baris.map(([label, nilai]) => `${label}: ${nilai}`).join('; ')
    : `Untuk: ${draft.keterangan}; Nominal: ${draft.nominal}; Ke: ${draft.pihak}; Tanggal: ${draft.tanggal}`;
  const tabel = cacaRingkasTabel(draft.tabel, 2000);
  return `Una menyusun draft dan menunggu persetujuan. ${draft.judul || ''} ${baris} ${tabel}`.replace(/\s+/g, ' ').trim();
}

// --- pemilih asisten: Una · Rika · Fina (src/agen-persona.js) ----------------
//
// Tiap persona punya percakapan sendiri (riwayat, tugas tertunda, draft tidak
// tercampur): kunci simpanan dan conversationId ikut persona. Una memakai kunci
// lama, jadi percakapan Una yang sudah ada tidak berubah. Pilihan terakhir diingat
// per halaman. Persona yang dimatikan/tidak diizinkan tidak dikirim server, jadi
// tidak tampil.
const CACA_AGEN_BAWAAN = 'una';
const CACA_NAMA_AGEN = Object.freeze({ una: 'Una', rika: 'Rika', fina: 'Fina' });
const CACA_INGAT_AGEN = 'lekerUnaAgen:';
// Draft → persona yang menyusunnya, supaya "Ya" tetap atas nama persona itu walau tab sudah diganti.
const cacaAgenDraft = new WeakMap();

function cacaKunciSimpanan(agen = cacaState.agen) {
  return agen === CACA_AGEN_BAWAAN ? CACA_SIMPANAN : `${CACA_SIMPANAN}:${agen}`;
}

function cacaNamaAgen(id = cacaState.agen) {
  return cacaState.daftarAgen.find(a => a.id === id)?.nama || CACA_NAMA_AGEN[id] || 'Una';
}

function cacaAgenDiingat() {
  try { return localStorage.getItem(CACA_INGAT_AGEN + (location.pathname || '/')) || ''; } catch { return ''; }
}

function cacaIngatAgen(id) {
  try { localStorage.setItem(CACA_INGAT_AGEN + (location.pathname || '/'), id); } catch { /* boleh gagal */ }
}

// Persona selain Una ikut dikirim; Una tidak mengirim apa pun (permintaan sama seperti dulu).
function cacaDenganAgen(isi, agen = cacaState.agen) {
  return agen && agen !== CACA_AGEN_BAWAAN ? { ...isi, agen } : isi;
}

function cacaRenderPilihAgen() {
  const wadah = cacaEl('cacaPilihAgen');
  if (!wadah) return;
  const daftar = cacaState.daftarAgen;
  wadah.classList.toggle('hidden', daftar.length < 2);
  wadah.innerHTML = daftar.map(a => `<button type="button" role="tab" data-caca-agen="${cacaEscape(a.id)}" aria-selected="${a.id === cacaState.agen}" title="${cacaEscape(`${a.nama} · ${a.peran}`)}">${cacaEscape(a.nama)}</button>`).join('');
}

function cacaSapaAgen() {
  const nama = cacaNamaAgen();
  const isi = {
    rika: `Halo Bos, ${nama} di sini. ${nama} bantu menelusuri angka yang janggal (HPP, jurnal, aturan jurnal, sinkron akuntansi) sampai ketemu langkah input yang keliru, lalu menyiapkan koreksinya sebagai draft.`,
    fina: `Halo Bos, ${nama} di sini. ${nama} bantu urusan CS: cek gerai kosong, cari freelance untuk backup, rekap masalah CS, catat pengganti, pasang pengumuman, draft SP, dan draft lowongan. Keputusan soal orang dan uang tetap di Bos.`
  }[cacaState.agen] || `Halo Bos, ${nama} di sini.`;
  cacaTambahPenanda('Hari ini');
  cacaTambahGelembung('caca', isi);
}

function cacaGantiAgen(id, { ingat = true } = {}) {
  if (id === cacaState.agen || !cacaState.daftarAgen.some(a => a.id === id)) return;
  if (cacaState.sedangKirim) return;
  cacaSimpanPercakapan();
  cacaState.agen = id;
  if (ingat) cacaIngatAgen(id);
  cacaState.riwayat = [];
  cacaState.tertunda = null;
  cacaState.kerjaTertunda = null;
  const wadah = cacaEl('cacaPercakapan');
  if (wadah) wadah.innerHTML = '';
  cacaPulihkanPercakapan();
  cacaRenderPilihAgen();
  const status = cacaEl('cacaStatus');
  if (status && !status.classList.contains('bermasalah')) status.textContent = `${cacaNamaAgen()} · siap membantu`;
  if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-agen-ganti', { detail: { agen: id } }));
  if (wadah && !wadah.childElementCount && cacaState.siapDipakai) {
    if (id === CACA_AGEN_BAWAAN) void cacaSapa(); else cacaSapaAgen();
  }
}

// Daftar persona datang dari pengaturan (public/caca-pengaturan.js).
function cacaTerimaDaftarAgen(daftar) {
  cacaState.daftarAgen = (Array.isArray(daftar) ? daftar : [])
    .filter(a => a && CACA_NAMA_AGEN[a.id])
    .map(a => ({ id: a.id, nama: String(a.nama || CACA_NAMA_AGEN[a.id]).slice(0, 32), peran: String(a.peran || '').slice(0, 40) }));
  const ada = id => cacaState.daftarAgen.some(a => a.id === id);
  // Persona yang sedang dipakai lalu dimatikan tenant: kembali ke Una.
  if (cacaState.agen !== CACA_AGEN_BAWAAN && !ada(cacaState.agen)) {
    if (!ada(CACA_AGEN_BAWAAN)) cacaState.daftarAgen.unshift({ id: CACA_AGEN_BAWAAN, nama: 'Una', peran: 'asisten toko' });
    cacaGantiAgen(CACA_AGEN_BAWAAN, { ingat: false });
  }
  const diingat = cacaAgenDiingat();
  if (diingat && diingat !== cacaState.agen && ada(diingat)) cacaGantiAgen(diingat, { ingat: false });
  cacaRenderPilihAgen();
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
  // Password awal akun baru cuma ditampilkan sekali: tidak ikut disimpan.
  salinan.querySelectorAll('.caca-rahasia').forEach(el => {
    el.innerHTML = '<p>🔒 Password awal disembunyikan. Lupa? Ganti di Tim → Akun Kasir.</p>';
  });
  while (salinan.childElementCount > CACA_MAKS_SIMPAN) salinan.firstElementChild.remove();
  try {
    sessionStorage.setItem(cacaKunciSimpanan(), JSON.stringify({ sidik: cacaSidikLogin(), html: salinan.innerHTML, riwayat: cacaState.riwayat }));
  } catch { /* penuh atau diblokir: percakapan tetap jalan, cuma tidak bertahan */ }
}

function cacaHapusSimpanan() {
  // Keluar login: percakapan semua persona dibuang.
  try { for (const id of Object.keys(CACA_NAMA_AGEN)) sessionStorage.removeItem(cacaKunciSimpanan(id)); } catch { /* boleh gagal */ }
}

// Draft yang belum dijawab tidak ikut hidup lagi. Tombol "Ya"-nya kehilangan
// isi draft yang dipegang halaman sebelumnya, dan menghidupkannya dari HTML
// saja berarti memposting sesuatu yang tidak lagi bisa dicek ulang di sini.
function cacaPulihkanPercakapan() {
  const wadah = cacaEl('cacaPercakapan');
  if (!wadah) return;
  let simpanan = null;
  try { simpanan = JSON.parse(sessionStorage.getItem(cacaKunciSimpanan()) || 'null'); } catch { simpanan = null; }
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
  // Bos Cyo 2026-10-15: di halaman Entity Admin bawaannya Entity (Laporan Usaha, data semua gerai);
  // pilihan terakhir tetap diingat. Workspace gerai dan mode Owner tetap memakai gerai.
  const bawaanEntity = !cacaDiWorkspace() && typeof entityAdminState !== 'undefined' && !entityAdminState.ownerMode && cacaState.stores.length > 0;
  cacaState.scope = masihAda ? ingatan : (bawaanEntity ? CACA_ENTITY : (cacaState.stores[0]?.code || ''));
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
  cacaHentikanSuara();
  cacaState.scope = scope;
  if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-scope-change'));
  window.UnaWorkspace?.scopeChanged();
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
  if (cacaState.agen !== CACA_AGEN_BAWAAN) { cacaSapaAgen(); return; }
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
  if (t.jenis === 'kanvas_usulan') {
    // Usulan tulisan dari bacaan lembar gambar (U7): patch tervalidasi, bisa di-undo.
    tombol.disabled = true;
    const hasil = await window.UnaKanvasBaca?.terapkan(t.actionId);
    cacaTambahGelembung('caca', hasil?.message || 'Lembar gambar belum siap.');
    cacaCatatRiwayat('una', hasil?.message || '');
    if (!hasil?.ok) tombol.disabled = false;
    return;
  }
  if (t.jenis === 'jelaskan') {
    await cacaJelaskan(t.topik, t.label);
    return;
  }
  if (t.jenis === 'buka') {
    cacaBukaLayar(t.layar, { halaman: t.halaman || 'gerai' });
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
  const mengetik = cacaTambahKerjaLive('Buka panduan…');
  const mulai = Date.now();
  try {
    const query = cacaState.scope === CACA_ENTITY ? 'lingkup=entity' : `store=${encodeURIComponent(cacaState.scope)}`;
    const hasil = await cacaApi(`/api/caca/jelaskan?${query}&topik=${encodeURIComponent(topik || '')}`);
    await cacaJedaManusiawi(mengetik, { ...hasil, alat: 'jelaskan' }, mulai);
    mengetik.remove();
    cacaTambahGelembung('caca', hasil.jawaban, hasil.judul ? `kamus · ${hasil.judul}` : '');
    cacaCatatRiwayat('una', hasil.jawaban);
    cacaTambahTawaran(hasil.tawaran);
    // "Mau Una buatkan?" — pesan berikutnya ("bisa buatin itu?") nyambung ke panduan ini.
    cacaState.tertunda = hasil.tertunda || null;
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  }
}

// --- membukakan layar ---------------------------------------------------------
//
// Untuk kerjaan yang memang tidak lewat chat (akun kasir: ada PIN), Una
// membukakan layarnya — bukan menyuruh mencari sendiri di menu.

const CACA_HASH_BUKA = '#una-buka=';

function cacaKlikTab(layar, sisaCoba = 20) {
  if (!/^[\w-]{1,40}$/.test(layar)) return false;
  const selector = `.admin-tab[data-tab="${layar}"], .admin-tab[data-entity-tab="${layar}"]`;
  const tombol = document.querySelector(selector);
  if (tombol && !tombol.disabled && !tombol.hidden && !tombol.classList.contains('hidden') && tombol.style.display !== 'none') {
    tombol.click();
    tombol.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    return true;
  }
  if (!tombol && sisaCoba > 0) setTimeout(() => cacaKlikTab(layar, sisaCoba - 1), 150);
  return false;
}
function cacaBukaLayar(layar, { halaman = 'gerai', tetapTerbuka = false } = {}) {
  if (!/^[\w-]{1,40}$/.test(layar) || !['gerai','entity'].includes(halaman)) return;
  const gerai = cacaGeraiAktif();
  const geraiHalaman = String(window.LEKER_STORE_CODE || '').toUpperCase();
  const halamanSama = halaman === 'entity' ? !cacaDiWorkspace() : cacaDiWorkspace() && geraiHalaman === gerai;
  if (halamanSama) {
    cacaKlikTab(layar);
    if (!tetapTerbuka && window.innerWidth <= 560) cacaTutupPanel();
    return;
  }
  if (halaman === 'gerai' && !gerai) { cacaTambahGelembung('caca', 'Pilih gerainya dulu lewat tombol di atas, Bos.'); return; }
  if (tetapTerbuka) { try { sessionStorage.setItem('lekerUnaBukaSesudahNavigasi','1'); } catch { /* mode privat */ } }
  const target = halaman === 'entity' ? '/entity-admin' : `/s/${encodeURIComponent(gerai)}/admin`;
  location.href = `${target}${CACA_HASH_BUKA}${encodeURIComponent(layar)}`;
}
function cacaBukaLayarDariHash() {
  if (!location.hash.startsWith(CACA_HASH_BUKA)) return;
  let layar;
  try { layar = decodeURIComponent(location.hash.slice(CACA_HASH_BUKA.length)); } catch { return; }
  history.replaceState(null, '', location.pathname + location.search);
  if (/^[\w-]{1,40}$/.test(layar)) cacaKlikTab(layar);
  try { if (sessionStorage.getItem('lekerUnaBukaSesudahNavigasi') === '1') { sessionStorage.removeItem('lekerUnaBukaSesudahNavigasi'); cacaBukaPanel(); } } catch { /* mode privat */ }
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

// Bos Cyo 2026-10-09: "ketika sudah di acc satu pencatatan maka draft catatan lainnya
// bakal kadaluarsa". Draft lain yang masih terbuka dimatikan begitu satu disetujui,
// supaya tidak ada draft basi yang bisa di-"Ya" belakangan.
function cacaKadaluarsakanDraftLain(kecuali) {
  const terbuka = cacaEl('cacaPercakapan')?.querySelectorAll('.caca-draft:not(.tercatat):not(.dibatalkan):not(.kedaluwarsa)') ?? [];
  for (const kartu of terbuka) {
    if (kartu === kecuali) continue;
    kartu.classList.add('kedaluwarsa');
    kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (!kartu.querySelector('.caca-draft-catatan')) {
      const catatan = document.createElement('p');
      catatan.className = 'caca-draft-catatan';
      catatan.textContent = 'Kedaluwarsa — ada catatan lain yang barusan disetujui. Minta Una susun ulang kalau masih perlu.';
      kartu.appendChild(catatan);
    }
  }
  cacaSimpanPercakapan();
}

// Draft hasil koreksi menggantikan draft yang masih terbuka di atasnya: tombolnya
// dimatikan supaya tidak ada dua draft untuk hal yang sama yang bisa di-"Ya".
function cacaGantiDraftLama() {
  const semua = [...(cacaEl('cacaPercakapan')?.querySelectorAll('.caca-draft:not(.tercatat):not(.dibatalkan):not(.kedaluwarsa)') ?? [])];
  for (const kartu of semua.slice(0, -1)) {
    kartu.classList.add('kedaluwarsa');
    kartu.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (!kartu.querySelector('.caca-draft-catatan')) {
      const catatan = document.createElement('p');
      catatan.className = 'caca-draft-catatan';
      catatan.textContent = 'Sudah diganti draft yang dikoreksi di bawah.';
      kartu.appendChild(catatan);
    }
  }
  cacaSimpanPercakapan();
}

function cacaBuatKartuWorkspace(draft) {
  const tampilan = cacaIsiDraft(draft);
  const kartu = document.createElement('div'); kartu.className = 'caca-draft';
  kartu.innerHTML = `<div class="caca-draft-judul">${cacaEscape(tampilan.judul)}</div>${tampilan.isi}<ul class="caca-draft-dampak">${(draft.dampak || []).map(d => `<li>${cacaEscape(d)}</li>`).join('')}</ul><p class="caca-draft-tenang">Belum ada perubahan sebelum draft diperiksa dan disetujui.</p><div class="caca-draft-aksi"></div>`;
  return kartu;
}

function cacaKonfigurasiWorkspace() {
  window.UnaWorkspace?.configure({
    api: cacaApi,
    getIdentity: () => localStorage.getItem('lekerEntityAdminToken') || '',
    getScope: () => cacaState.scope,
    // Petunjuk peran untuk registry lembar; otorisasi tetap di server.
    getRole: () => cacaDiWorkspace() ? 'ADMIN' : 'ENTITY_ADMIN',
    scopeQuery: cacaQueryLingkup,
    scopeLabel: cacaNamaScope,
    renderDraft: cacaBuatKartuWorkspace,
    setPending: value => { cacaState.tertunda = value; },
    addCompact: (text, id) => {
      const bubble = cacaTambahGelembung('caca', '');
      const compact = document.createElement('button'); compact.type = 'button'; compact.className = 'secondary-btn caca-workspace-compact'; compact.textContent = text; compact.dataset.unaWorkspaceTask = id; bubble.appendChild(compact); cacaSimpanPercakapan(); return compact;
    },
    onAccountChange: cacaLupakan,
    onCancel: () => { cacaCatatRiwayat('sistem', 'Bos membatalkan draft itu.'); cacaTambahGelembung('caca', 'Oke, draft dibatalkan.'); cacaSimpanPercakapan(); },
    executeEphemeral: async (draft, scope, bagian) => {
      const result = await cacaApi(`/api/caca/catat?${cacaQueryLingkup(scope)}`, { method: 'POST', body: JSON.stringify(cacaDenganAgen({ draft, ...(bagian == null ? {} : { bagian }) }, cacaAgenDraft.get(draft) || cacaState.agen)) });
      return { result, rahasia: result.rahasia };
    },
    onCompleted: async (task, response, kartu) => {
      if (window.UnaWorkspace?.isSelected(task.id)) cacaState.tertunda = null;
      const scope = task.scope.lingkup === 'entity' ? CACA_ENTITY : task.scope.storeCode;
      if (task.draft.bertahap) {
        const results = task.results.map(entry => entry.result || {});
        await cacaSelesaikanBertahap(kartu, task.draft, scope, results);
      } else {
        const hasil = response.result || task.results?.[0]?.result || {};
        kartu?.classList.add('tercatat');
        cacaCatatRiwayat('sistem', `Bos menyetujui draft itu dan sudah dijalankan. ${hasil.jawaban || ''}`);
        if (hasil.jawaban) cacaTambahGelembung('caca', hasil.jawaban);
        if (task.draft.aksi === 'buat_barang') {
          if (task.draft.muatan?.name && window.UnaWorkspace?.isSelected(task.id)) cacaState.tertunda = { alat: 'ubah_barang', tangkapan: { ubah_daftar: [{ barang: task.draft.muatan.name }] }, tanya: '', kurang: null, revisi: true, tercatat: true };
          cacaObrolanSesudahBarang(task.draft, [task.draft.muatan?.name].filter(Boolean));
        }
      }
      if (response.rahasia?.nilai) cacaTampilkanRahasia(response.rahasia);
      cacaSimpanPercakapan();
    }
  });
}

function cacaTampilkanDraft(payload, scope, { sesudah = null } = {}) {
  cacaKonfigurasiWorkspace();
  if (!window.UnaWorkspace) { cacaTambahGelembung('caca', 'Workspace belum termuat. Muat ulang halaman untuk memeriksa dan menyetujui draft dengan aman.'); return; }
  if (payload?.draft && typeof payload.draft === 'object') cacaAgenDraft.set(payload.draft, cacaState.agen);
  window.UnaWorkspace.capture(payload, scope, { sesudah });
}

// Password awal akun yang barusan dibuat Una (src/caca-aksi-karyawan.js). Sengaja
// TIDAK dicatat ke riwayat (riwayat ikut terkirim ke mesin AI) dan tidak ikut
// tersimpan di sessionStorage (cacaSimpanPercakapan menggantinya dengan tanda).
function cacaTampilkanRahasia(rahasia) {
  const html = `
    <div class="caca-rahasia">
      <div class="caca-draft-baris"><span>${cacaEscape(rahasia.label || 'Password')}</span><strong class="caca-rahasia-nilai" style="font-family: ui-monospace, monospace; letter-spacing: .08em">${cacaEscape(rahasia.nilai)}</strong></div>
      <p class="caca-draft-tenang">Catat atau salin sekarang, lalu berikan ke orangnya. Password ini tidak ditampilkan lagi — kalau lupa, ganti di Tim → Akun Kasir.</p>
      <div class="caca-draft-aksi"><button class="secondary-btn" type="button" data-caca-salin>Salin password</button></div>
    </div>`;
  const gelembung = cacaTambahGelembung('caca', '', '', { html });
  gelembung.querySelector('[data-caca-salin]')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(rahasia.nilai); e.target.textContent = 'Tersalin ✓'; } catch { e.target.textContent = 'Salin manual ya'; }
  });
}

// --- draft bertahap -----------------------------------------------------------
//
// Isi barang massal dan batalkan barang dikirim satu baris per permintaan
// (paket Cloudflare gratis membatasi kerja per permintaan; lihat
// src/caca-aksi-barang.js). Panel yang mengulang, dan pemilik melihat
// hitungannya jalan. Yang gagal di tengah bisa dilanjutkan dari baris itu.

async function cacaSelesaikanBertahap(kartu, draft, scope, hasil) {
  const teks = document.createElement('p'); teks.className = 'caca-kemajuan-teks'; kartu?.appendChild(teks);
  kartu.classList.add('tercatat');
  cacaKadaluarsakanDraftLain(kartu);
  const selesai = hasil.filter(Boolean);
  // Rencana bertahap menunggu draft ini selesai sebelum lanjut ke langkah berikutnya.
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
  if (draft.aksi === 'betulkan_klasifikasi_barang') {
    const dibetulkan = selesai.filter(h => h.hasil === 'diubah');
    teks.textContent = `Selesai: ${dibetulkan.length} barang dibetulkan klasifikasinya.`;
    cacaCatatRiwayat('sistem', `Bos menyetujui; Una membetulkan klasifikasi ${dibetulkan.length} barang: ${dibetulkan.map(h => h.nama).join(', ')}.`);
    cacaSimpanPercakapan();
    const gerai = cacaNamaScope(scope);
    cacaTambahGelembung('caca', `Beres, ${dibetulkan.length} barang di Data Barang ${gerai} sudah Una betulkan tipe/jenis/satuannya. Angka stok, HPP, dan resep tidak diubah.`);
    return;
  }
  if (draft.aksi === 'koreksi_hpp_banyak') {
    const dikoreksi = selesai.filter(h => h.hasil === 'dikoreksi');
    const sudahBenar = selesai.filter(h => h.hasil === 'sudah_sesuai');
    teks.textContent = `Selesai: HPP ${dikoreksi.length} bahan dikoreksi${sudahBenar.length ? `, ${sudahBenar.length} sudah benar` : ''}.`;
    cacaCatatRiwayat('sistem', `Bos menyetujui; Una mengoreksi HPP ${dikoreksi.length} bahan: ${dikoreksi.map(h => h.nama).join(', ')}${sudahBenar.length ? `. Sudah benar (dilewati): ${sudahBenar.map(h => h.nama).join(', ')}` : ''}.`);
    cacaSimpanPercakapan();
    const gerai = cacaNamaScope(scope);
    cacaTambahGelembung('caca', `Beres, HPP ${dikoreksi.length} bahan di ${gerai} sudah Una koreksi dan penjualannya dihitung ulang${sudahBenar.length ? ` (${sudahBenar.length} ternyata sudah benar, Una lewati)` : ''}. Rinciannya ada di Riwayat Hitung Ulang HPP. Jurnal koreksinya dibuat otomatis; kalau ada yang belum masuk pembukuan, minta Una Sinkron Akuntansi.`);
    return;
  }
  if (draft.aksi === 'samakan_aturan_jurnal') {
    // Tiap langkah membawa kalimat hasilnya sendiri (aturan ditambah / transaksi terjurnal).
    const ringkas = selesai.map(h => h.nama).filter(Boolean);
    teks.textContent = 'Selesai: aturan jurnal dilengkapi dan transaksi yang mandek dikirim ulang.';
    cacaCatatRiwayat('sistem', `Bos menyetujui; Una menyambungkan jurnal. ${ringkas.join(' ')}`);
    cacaSimpanPercakapan();
    cacaTambahGelembung('caca', ['Beres, Bos! Jurnalnya sudah Una sambungkan:', ...ringkas].join('\n'));
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
  // Jawaban mode Analisis diberi tanda supaya kelihatan dikerjakan Claude, bukan model murah.
  const mesin = payload.analisis ? '🔬 Claude Sonnet' : '';
  const dasar = cacaJejakDasar(payload);
  return [mesin, dasar].filter(Boolean).join(' · ');
}

function cacaJejakDasar(payload) {
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
  if (tombol) tombol.disabled = !(cacaState.siap && ada && !cacaState.sedangKirim && !cacaSuara.sesi && !cacaSedangNgambek());
  const mikrofon = cacaEl('cacaMikrofon');
  if (mikrofon) mikrofon.disabled = !cacaPengenalSuara() || (!cacaSuara.sesi && (!cacaState.siap || cacaState.sedangKirim || cacaSedangNgambek()));
}


// Suara mengisi composer; pengiriman dan persetujuan tetap manual.
const cacaSuara = { sesi: null, dariMikrofon: false, menyiapkan: false };
let cacaMulut = null;
let cacaMulutGenerasi = 0;
const cacaMulutKonteks = new WeakMap();
function cacaDiam() {
  cacaMulutGenerasi += 1;
  cacaMulut?.hentikan();
}
function cacaAturMulut(status) {
  const nama = typeof cacaNamaAsisten === 'function' ? cacaNamaAsisten() : 'Una';
  const toggle = cacaEl('cacaMulutToggle');
  toggle?.classList.toggle('hidden', !status.tersedia);
  toggle?.setAttribute('aria-pressed', String(status.aktif));
  toggle?.setAttribute('aria-label', `${nama} bicara`);
  if (toggle) toggle.title = `${nama} bicara: ${status.aktif ? 'nyala' : 'mati'}`;
  cacaEl('cacaMulutStop')?.classList.toggle('hidden', !status.membaca);
  cacaEl('cacaPercakapan')?.querySelectorAll('[data-caca-dengar]').forEach(tombol => tombol.classList.toggle('hidden', !status.tersedia));
}
function cacaBacakanBalasan(payload, gelembung) {
  if (!window.KerangkaSuara) return;
  const options = { draft: payload.perluKonfirmasi ? payload.draft : null, rahasia: Boolean(payload.rahasia) };
  const bersih = window.KerangkaSuara.bersihkanUntukDibaca(payload.jawaban, options);
  if (!bersih) return;
  const scope = cacaMulutKonteks.get(payload)?.scope || cacaState.scope;
  if (gelembung) {
    const tombol = document.createElement('button');
    tombol.type = 'button'; tombol.className = 'caca-dengar secondary-btn';
    tombol.textContent = '▶ dengarkan';
    tombol.dataset.cacaDengar = bersih; tombol.dataset.cacaScope = scope;
    tombol.classList.toggle('hidden', !cacaMulut?.status().tersedia);
    gelembung.appendChild(tombol);
    cacaSimpanPercakapan();
  }
  const konteks = cacaMulutKonteks.get(payload);
  if (konteks && konteks.generasi === cacaMulutGenerasi && konteks.scope === cacaState.scope
      && konteks.login === cacaSidikLogin() && !document.hidden && !cacaEl('cacaPanel')?.classList.contains('hidden')) {
    cacaMulut?.ucapkan(bersih, { paksa: konteks.suara });
  }
}
function cacaPasangMulut() {
  if (!window.KerangkaSuara || cacaMulut) return;
  cacaMulut = window.KerangkaSuara.buat({ key: 'lekerUnaBicara', onChange: cacaAturMulut,
    onStatus: cacaStatusSuara, bolehBicara: () => !cacaSuara.sesi && !document.hidden && !cacaEl('cacaPanel')?.classList.contains('hidden') });
  cacaEl('cacaMulutToggle')?.addEventListener('click', () => cacaMulut.setAktif(!cacaMulut.status().aktif));
  cacaEl('cacaMulutStop')?.addEventListener('click', cacaDiam);
  cacaEl('cacaPercakapan')?.addEventListener('click', event => {
    const tombol = event.target.closest('[data-caca-dengar]');
    if (!tombol) return;
    if (tombol.dataset.cacaScope !== cacaState.scope) { cacaStatusSuara('Pilih gerai pesan ini sebelum mendengarkan.'); return; }
    cacaMulut.ucapkan(tombol.dataset.cacaDengar, { paksa: true });
  });
}
const cacaPengenalSuara = () => window.SpeechRecognition || window.webkitSpeechRecognition;
function cacaStatusSuara(teks) {
  const status = cacaEl('cacaSuaraStatus');
  if (status) status.textContent = teks;
}
function cacaSelesaiSuara(sesi, pesan) {
  if (cacaSuara.sesi !== sesi) return;
  cacaSuara.sesi = null;
  clearTimeout(sesi.batas);
  clearTimeout(sesi.tungguAkhir);
  const input = cacaEl('cacaPertanyaan');
  if (input) input.readOnly = sesi.readOnly;
  const tombol = cacaEl('cacaMikrofon');
  tombol?.setAttribute('aria-pressed', 'false');
  tombol?.setAttribute('aria-label', 'Mulai bicara');
  if (tombol) tombol.title = 'Beri tugas lewat suara';
  cacaStatusSuara(pesan);
  cacaAturTombol();
}
function cacaHentikanSuara() {
  cacaDiam();
  cacaSuara.dariMikrofon = false;
  const sesi = cacaSuara.sesi;
  if (!sesi) return;
  cacaSelesaiSuara(sesi, 'Suara dihentikan. Periksa teks sebelum mengirim.');
  sesi.rekaman?.abort();
  try { sesi.pengenal.abort(); } catch { /* sudah berhenti */ }
}
async function cacaToggleSuara() {
  cacaDiam();
  const aktif = cacaSuara.sesi;
  if (aktif) {
    if (aktif.berhenti) return;
    aktif.berhenti = true;
    aktif.tungguAkhir = setTimeout(() => {
      if (cacaSuara.sesi === aktif) cacaHentikanSuara();
    }, 3000);
    cacaStatusSuara('Menyelesaikan teks suara...');
    try { aktif.pengenal.stop(); } catch { cacaHentikanSuara(); }
    return;
  }
  const Pengenal = cacaPengenalSuara();
  if (!Pengenal) {
    cacaStatusSuara('Browser ini belum mendukung input suara. Gunakan dikte keyboard atau ketik pesan.');
    return;
  }
  const input = cacaEl('cacaPertanyaan');
  if (!input || input.disabled || !cacaState.siap || cacaState.sedangKirim || cacaSedangNgambek()) return;
  if (!window.isSecureContext) {
    cacaStatusSuara('Input suara perlu halaman HTTPS. Pesan tetap bisa diketik.');
    return;
  }
  if (cacaSuara.menyiapkan) return;
  if (typeof cacaSiapkanSuara === 'function') {
    cacaSuara.menyiapkan = true;
    try { await cacaSiapkanSuara(); } catch(error) { cacaStatusSuara(error.message); return; }
    finally { cacaSuara.menyiapkan = false; }
    if (!cacaState.siap || cacaState.sedangKirim) return;
  }
  const pemilik = window.cacaSuaraPemilik;
  if (typeof cacaPengaturanProfil === 'function' && (!cacaPengaturanProfil() || !pemilik)) { cacaStatusSuara('Profil asisten sedang dimuat. Coba mikrofon kembali setelah pengaturan siap.'); return; }
  let pengenal;
  try { pengenal = window.KerangkaSuara ? window.KerangkaSuara.dengar({ mulai: false }) : new Pengenal(); } catch {
    cacaStatusSuara('Input suara tidak dapat dimulai. Ketik pesan atau coba browser lain.');
    return;
  }
  let rekaman = null;
  if (pemilik?.wajib()) {
    const scopeAwal = cacaState.scope, loginAwal = cacaSidikLogin();
    try {
      cacaStatusSuara('Memuat pengenal suara pemilik…');
      await pemilik.muatModel();
      rekaman = await pemilik.rekamManual();
      if (cacaState.scope !== scopeAwal || cacaSidikLogin() !== loginAwal || window.cacaSuaraPemilik !== pemilik) { rekaman.abort(); return; }
    } catch (error) { cacaStatusSuara(error.message); return; }
  }
  const sesi = { pengenal, rekaman, pemilik, teks: '', prefix: input.value, readOnly: input.readOnly, adaSuara: false, berhenti: false };
  cacaSuara.sesi = sesi;
  pengenal.lang = 'id-ID';
  pengenal.continuous = true;
  pengenal.interimResults = true;
  input.readOnly = true;
  const tombol = cacaEl('cacaMikrofon');
  tombol?.setAttribute('aria-pressed', 'true');
  tombol?.setAttribute('aria-label', 'Selesai bicara');
  if (tombol) tombol.title = 'Selesai bicara';
  cacaStatusSuara('Izinkan mikrofon. Pengenalan suara mengikuti layanan browser.');
  cacaAturTombol();
  pengenal.onstart = () => {
    if (cacaSuara.sesi === sesi && !sesi.berhenti) cacaStatusSuara('Mendengarkan... Klik mikrofon lagi setelah selesai. Teks belum dikirim.');
  };
  pengenal.onresult = event => {
    if (cacaSuara.sesi !== sesi) return;
    const potongan = [];
    for (let i = 0; i < event.results.length; i += 1) potongan.push(event.results[i][0]?.transcript || '');
    const teks = potongan.join(' ').trim();
    sesi.adaSuara = Boolean(teks);
    sesi.teks = teks;
    if (sesi.rekaman) return; // Teks suara belum dipakai sebelum identitas pembicara cocok.
    if (teks) cacaSuara.dariMikrofon = true;
    input.value = sesi.prefix + (sesi.prefix && teks && !/\s$/.test(sesi.prefix) ? ' ' : '') + teks;
    cacaAturTinggiKetik();
  };
  pengenal.onerror = event => {
    if (cacaSuara.sesi !== sesi) return;
    const pesan = {
      'not-allowed': 'Akses mikrofon ditolak. Izinkan mikrofon di pengaturan situs lalu coba lagi.',
      'service-not-allowed': 'Layanan suara diblokir browser. Gunakan browser lain atau ketik pesan.',
      'audio-capture': 'Mikrofon tidak tersedia. Periksa perangkat mikrofon lalu coba lagi.',
      'network': 'Layanan suara tidak tersambung. Periksa koneksi lalu coba lagi.',
      'no-speech': 'Suara belum terdengar. Klik mikrofon untuk mencoba lagi.',
      'language-not-supported': 'Bahasa Indonesia belum didukung layanan suara browser ini.'
    }[event.error] || 'Input suara berhenti. Periksa teks atau coba lagi.';
    sesi.rekaman?.abort();
    cacaSelesaiSuara(sesi, pesan);
    try { pengenal.abort(); } catch { /* sudah berhenti */ }
  };
  pengenal.onend = async () => {
    if (cacaSuara.sesi !== sesi) return;
    if (sesi.rekaman) {
      clearTimeout(sesi.batas); clearTimeout(sesi.tungguAkhir);
      cacaStatusSuara('Memeriksa suara pemilik…');
      try {
        const hasil = await sesi.pemilik.verifikasi(sesi.rekaman.stop());
        if (cacaSuara.sesi !== sesi) return;
        if (!hasil.cocok) { cacaSuara.dariMikrofon = false; cacaSelesaiSuara(sesi, 'Suara belum cocok dengan pemilik. Pesan suara tidak dipakai.'); return; }
        input.value = sesi.prefix + (sesi.prefix && sesi.teks && !/\s$/.test(sesi.prefix) ? ' ' : '') + sesi.teks;
        cacaSuara.dariMikrofon = Boolean(sesi.teks); cacaAturTinggiKetik();
      } catch (error) { if (cacaSuara.sesi === sesi) { cacaSuara.dariMikrofon = false; cacaSelesaiSuara(sesi, error.message); } return; }
    }
    cacaSelesaiSuara(sesi, sesi.adaSuara ? 'Periksa teks, lalu tekan Kirim untuk memberi tugas ke Una.' : 'Suara belum terdengar. Klik mikrofon untuk mencoba lagi.');
  };
  sesi.batas = setTimeout(() => {
    if (cacaSuara.sesi === sesi) cacaToggleSuara();
  }, sesi.rekaman ? 20000 : 60000);
  try { pengenal.start(); } catch {
    cacaSelesaiSuara(sesi, 'Mikrofon gagal dimulai. Coba lagi atau ketik pesan.');
  }
}

// --- Una ngambek ------------------------------------------------------------
// Bos Cyo 2026-10-09: kalau Una terpaksa mengulang balasan yang sama berkali-kali,
// di tingkat terakhir "chat ga bisa dipakai beberapa saat, tunggu sampai una engga
// ngambek". Server menentukan kapan (src/caca-tertunda.js); panel menutup kotak ketik
// dengan hitung mundur (jam browser saja, tidak bertanya ke server).
function cacaSedangNgambek() {
  return Number(cacaState.ngambekSampai || 0) > Date.now();
}

function cacaMulaiNgambek(detik) {
  const kotak = cacaEl('cacaPertanyaan');
  cacaState.ngambekSampai = Date.now() + Math.max(5, Math.min(Number(detik) || 60, 300)) * 1000;
  const asli = kotak?.getAttribute('placeholder') || 'Ketik pesan';
  if (kotak) { kotak.disabled = true; kotak.dataset.placeholderAsli = asli; }
  const jalan = () => {
    const sisa = Math.ceil((cacaState.ngambekSampai - Date.now()) / 1000);
    if (sisa <= 0) {
      clearInterval(jam);
      cacaState.ngambekSampai = 0;
      if (kotak) { kotak.disabled = false; kotak.setAttribute('placeholder', kotak.dataset.placeholderAsli || 'Ketik pesan'); }
      cacaTambahGelembung('caca', 'Oke deh, Una udah nggak ngambek 😌 Yuk lanjut, kasih infonya yang jelas ya.');
      cacaAturTombol();
      return;
    }
    if (kotak) kotak.setAttribute('placeholder', `Una lagi ngambek 😤 tunggu ${sisa} detik…`);
  };
  const jam = setInterval(jalan, 1000);
  jalan();
  cacaAturTombol();
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
async function cacaTanyaServer(pertanyaan, scope, riwayat, kerja = null, tertunda = null) {
  // satuLangkah: server mengerjakan satu putaran lalu membalas, supaya kartu
  // "Una lagi kerja" bisa mencentang tiap langkah begitu selesai.
  // tertunda: tugas yang tadi belum lengkap (Una sedang bertanya), supaya jawaban
  // Bos melengkapi isiannya, bukan dibaca dari nol (src/caca-tertunda.js).
  let conversationId;
  try {
    const key = cacaKunciSimpanan() + ':id:' + cacaSidikLogin();
    conversationId = sessionStorage.getItem(key);
    if (!conversationId) { conversationId = crypto.randomUUID(); sessionStorage.setItem(key, conversationId); }
  } catch { /* namespace cadangan tetap di server */ }
  const isi = cacaDenganAgen({ pertanyaan, riwayat, satuLangkah: true, conversationId });
  if (cacaState.analisisGiliran) isi.analisis = true;
  // Konteks lembar Workspace yang sedang tampil (U4 Una Live), dibaca saat dikirim.
  const lembar = cacaState.turnId ? window.UnaDispatcher?.context({ conversationId, turnId: cacaState.turnId }) : null;
  if (lembar) isi.surfaceContext = lembar;
  cacaState.konteksLembar = lembar;
  if (kerja) isi.kerja = kerja;
  if (tertunda) isi.tertunda = tertunda;
  return cacaApi(`/api/caca/tanya?${cacaQueryLingkup(scope)}`, { method: 'POST', body: JSON.stringify(isi) });
}

// --- mode agen berputar -------------------------------------------------------
//
// Una boleh melihat hasil alatnya lalu memutuskan langkah berikutnya sendiri.
// Satu permintaan ke server memuat beberapa putaran; kalau belum tuntas, server
// membalas `lanjutkan` + catatan kerja dan panel mengirim ulang (permintaan baru =
// jatah kerja Cloudflare baru). Draft tetap berhenti menunggu "Ya"; sesudah
// disetujui, Una melanjutkan dari catatan yang sama.
// Server juga membatasi 12 langkah per perintah; ini batas sisi panel.
const CACA_MAKS_LANJUT_OTOMATIS = 11;

async function cacaTanyaSampaiTuntas(pertanyaan, scope, riwayat, kerja, mengetik, tertunda = null) {
  if (kerja?.length) mengetik?.aturLangkah?.(kerja, 'Lanjut ke langkah berikutnya…');
  let payload = await cacaTanyaServer(pertanyaan, scope, riwayat, kerja, tertunda);
  for (let i = 0; i < CACA_MAKS_LANJUT_OTOMATIS && payload.lanjutkan && payload.kerja?.length; i += 1) {
    mengetik?.aturLangkah?.(payload.kerja, 'Mikirin langkah berikutnya…');
    payload = await cacaTanyaServer(pertanyaan, scope, riwayat, payload.kerja);
  }
  return payload;
}

// Kartu "Una lagi kerja" ala agen: langkah yang sudah beres dicentang satu per
// satu, langkah yang sedang jalan berputar, dan stopwatch-nya jalan (hitungan di
// browser saja, tidak bertanya ke server). Kelas `mengetik` membuatnya tidak ikut
// tersimpan dan diperlakukan sama dengan gelembung "mengetik" lama.
function cacaTambahKerjaLive(awal = 'Memahami perintah Bos…') {
  const wadah = cacaEl('cacaPercakapan');
  const gelembung = document.createElement('div');
  gelembung.className = 'caca-gelembung caca lebar mengetik caca-live';
  gelembung.setAttribute('aria-live', 'polite');
  gelembung.innerHTML = `
    <div class="caca-live-kepala"><span class="caca-live-putar" aria-hidden="true"></span><strong>Una lagi kerja</strong><span class="caca-live-waktu">0 dtk</span></div>
    <ol class="caca-live-langkah"></ol>`;
  wadah.appendChild(gelembung);
  cacaSetStatusMengetik(true);
  const mulai = Date.now();
  const waktu = gelembung.querySelector('.caca-live-waktu');
  const jam = setInterval(() => { waktu.textContent = `${Math.round((Date.now() - mulai) / 1000)} dtk`; }, 1000);
  gelembung.aturLangkah = (kerja = [], sedang = awal) => {
    gelembung.querySelector('.caca-live-langkah').innerHTML = [
      ...kerja.map(k => `<li class="selesai"><span class="caca-live-tanda">✓</span><span>${cacaEscape(k.judul || k.alat)}</span></li>`),
      `<li class="jalan"><span class="caca-live-tanda"><i></i><i></i><i></i></span><span>${cacaEscape(sedang)}</span></li>`
    ].join('');
    cacaGulirKeBawah();
  };
  gelembung.aturLangkah([], awal);
  const hapusAsli = gelembung.remove.bind(gelembung);
  let sudah = false;
  gelembung.remove = () => {
    clearInterval(jam);
    hapusAsli();
    if (!sudah) { sudah = true; cacaSetStatusMengetik(false); }
  };
  cacaGulirKeBawah();
  return gelembung;
}

// Bos Cyo 2026-10-10: "jangan keliatan langsung 0.3ms, harusnya tetep ada proses
// kaya una mengetik gitu, kalo langsung jawab itu malah kaya robot". Jawaban yang
// dihitung kode (panduan, tanpa mesin AI) datang hampir seketika; kartu "Una lagi
// kerja" tetap ditahan sebentar — makin panjang jawabannya makin lama, tapi
// dibatasi supaya tidak terasa lemot. Jawaban yang memang sudah lama tidak ditahan lagi.
function cacaLamaMengetik(payload) {
  const panjang = String(payload?.jawaban || '').length + (payload?.draft ? 200 : 0);
  return Math.min(2600, Math.max(900, 500 + panjang * 6));
}

async function cacaJedaManusiawi(mengetik, payload, mulai) {
  const sisa = cacaLamaMengetik(payload) - (Date.now() - mulai);
  if (sisa <= 0) return;
  const langkah = payload?.alat === 'jelaskan' ? 'Buka panduan' : 'Pahami maksud Bos';
  mengetik?.aturLangkah?.([{ judul: langkah }], payload?.draft ? 'Menyusun draft…' : 'Mengetik jawaban…');
  await new Promise(selesai => setTimeout(selesai, sisa));
}

// Langkah yang sudah dijalankan Una, ditulis seperti agen: 1. … ✓ 2. … ⏸
function cacaHtmlKerja(payload) {
  const kerja = Array.isArray(payload.kerja) ? payload.kerja : [];
  if (!kerja.length) return '';
  const menunggu = payload.perluKonfirmasi && payload.lanjutSesudahYa;
  return `<ol class="caca-kerja">${kerja.map((k, i) => {
    const tunggu = menunggu && i === kerja.length - 1;
    return `<li class="${tunggu ? 'menunggu' : 'selesai'}">${cacaEscape(k.judul || k.alat)} <span class="caca-rencana-tanda">${tunggu ? '⏸' : '✓'}</span></li>`;
  }).join('')}</ol>`;
}

function cacaTombolLanjutKerja(gelembung, pertanyaan, scope, kerja) {
  const tombol = document.createElement('button');
  tombol.type = 'button';
  tombol.className = 'secondary-btn caca-kerja-lanjut';
  tombol.textContent = 'Lanjutkan kerjaan';
  tombol.addEventListener('click', () => {
    tombol.remove();
    cacaLanjutkanKerja(pertanyaan, scope, kerja);
  });
  gelembung?.appendChild(tombol);
}

async function cacaLanjutkanKerja(pertanyaan, scope, kerja) {
  const riwayat = cacaRiwayatUntukServer();
  const mengetik = cacaTambahKerjaLive('Lanjut ke langkah berikutnya…');
  try {
    const payload = await cacaTanyaSampaiTuntas(pertanyaan, scope, riwayat, kerja, mengetik);
    mengetik.remove();
    cacaTampilkanBalasanAgen(payload, pertanyaan, scope);
  } catch (error) {
    mengetik.remove();
    const gelembung = cacaTambahGelembung('caca', `Kerjaannya terputus: ${error.message}`);
    cacaTombolLanjutKerja(gelembung, pertanyaan, scope, kerja);
  }
}

// Balasan pesan biasa: langkah kerja, lanjut sesudah "Ya", tombol lanjut.
function cacaTampilkanBalasanAgen(payload, pertanyaan, scope) {
  if (payload.alat === 'buka_layar') {
    const jenis = cacaTampilkanBalasan(payload, scope);
    if (payload.navigasi && scope === cacaState.scope) cacaBukaLayar(payload.navigasi.tab, { halaman: payload.navigasi.halaman, tetapTerbuka: true });
    return jenis; // Navigasi tidak membuang draft/tugas tertunda yang sedang diperiksa.
  }
  cacaState.kerjaTertunda = null;
  // Una balik bertanya untuk tugas yang belum lengkap: dibawa ke pesan berikutnya.
  // Draft yang masih menunggu "Ya" juga dibawa (revisi): "eh salah, harga belinya
  // harusnya 100" mengoreksi draft itu, bukan dibaca sebagai perintah baru.
  const workspaceContext = window.UnaWorkspace?.context();
  const sameWorkspaceVersion = !payload._workspaceContext || (workspaceContext?.id === payload._workspaceContext.id && workspaceContext?.revision === payload._workspaceContext.revision);
  if (!window.UnaWorkspace?.hasDirtySelection() && sameWorkspaceVersion) cacaState.tertunda = payload.tertunda
    || (payload.perluKonfirmasi && payload.draft?.aksi && payload.draft.tangkapan
      ? { alat: payload.draft.aksi, tangkapan: payload.draft.tangkapan, tanya: '', kurang: null, revisi: true }
      : null);
  const jenis = cacaTampilkanBalasan(payload, scope, {
    sesudahDraft: payload.lanjutSesudahYa && payload.kerja?.length ? status => {
      if (status !== 'tercatat') return;
      const catatan = [...cacaState.riwayat].reverse().find(r => r.dari === 'sistem');
      const kerja = [...payload.kerja, { alat: 'persetujuan', judul: 'Bos setuju, sudah disimpan', hasil: catatan?.teks || 'Draft disetujui dan sudah dijalankan.' }];
      cacaLanjutkanKerja(pertanyaan, scope, kerja);
    } : null
  });
  if (payload.revisi && payload.draft) cacaGantiDraftLama();
  if (payload.ngambek) cacaMulaiNgambek(payload.ngambek.detik);
  if (payload.lanjutkan && payload.kerja?.length) {
    const gelembung = cacaEl('cacaPercakapan')?.lastElementChild;
    cacaTombolLanjutKerja(gelembung, pertanyaan, scope, payload.kerja);
  } else if (jenis === 'tanya' && payload.kerja?.length) {
    // Una bertanya di tengah kerjaan (mis. harga normal berapa): pesan Bos
    // berikutnya dikirim bersama catatan kerja supaya Una lanjut, bukan mulai lagi.
    cacaState.kerjaTertunda = { kerja: payload.kerja, scope };
  }
  return jenis;
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
    const kerja = cacaHtmlKerja(payload);
    if (kerja) cacaTambahGelembung('caca', '', '', { html: kerja });
    cacaTampilkanDraft(payload, scope, { sesudah: sesudahDraft });
    cacaBacakanBalasan(payload, cacaEl('cacaPercakapan')?.lastElementChild);
    return 'draft';
  }
  // Jejak alat sengaja ditampilkan: angka yang muncul harus bisa ditelusuri
  // asalnya, bukan diterima begitu saja karena keluar dari mulut Una.
  const tabel = cacaRenderTabel(payload.tabel);
  const peringatan = payload.peringatan ? `<p class="caca-peringatan">${cacaEscape(payload.peringatan)}</p>` : '';
  const kerja = cacaHtmlKerja(payload);
  if (tabel || peringatan || kerja) {
    // Langkah kerja di atas, kalimatnya sesudahnya, tabel paling bawah.
    cacaTambahGelembung('caca', '', cacaJejakAlat(payload), { html: `${kerja}<p>${cacaEscape(payload.jawaban)}</p>${tabel}${peringatan}` });
  } else {
    cacaTambahGelembung('caca', payload.jawaban, cacaJejakAlat(payload));
  }
  cacaBacakanBalasan(payload, cacaEl('cacaPercakapan')?.lastElementChild);
  cacaTambahTawaran(payload.tawaran);
  if (payload.belumLengkap && payload.tertunda) { cacaKonfigurasiWorkspace(); window.UnaWorkspace?.capture(payload, scope); }
  if (payload.rencana) return 'rencana';
  return payload.belumLengkap ? 'tanya' : 'jawab';
}

async function cacaKirimTeks(pertanyaan, suaraKonteks = null) {
  const riwayat = cacaRiwayatUntukServer();
  cacaTambahGelembung('saya', pertanyaan);
  cacaCatatRiwayat('saya', pertanyaan);
  if (!cacaCekGerai({ bolehEntity: true })) return;

  // "batal"/"gajadi" diketik saat draft terakhir masih menunggu = tombol Batal
  // (uji live 2026-10-09: tanpa ini model mengira perintah menonaktifkan barang).
  if (/^\s*(batal(in|kan)?|ga+k?\s*jadi|gajadi|nggak\s*jadi|cancel)\b/i.test(pertanyaan)) {
    if (await window.UnaWorkspace?.cancelSelected()) return;
    const drafts = cacaEl('cacaPercakapan')?.querySelectorAll('.caca-draft:not(.tercatat):not(.dibatalkan):not(.kedaluwarsa)');
    const terakhir = drafts?.length ? drafts[drafts.length - 1] : null;
    const tombol = terakhir?.querySelector('[data-caca-batal]:not(:disabled)');
    if (tombol) { tombol.click(); return; }
  }

  // "stop/berhenti" saat Una masih memuat laporan: berhenti menunggu bacaan itu saja.
  // Draft bisnis dan persetujuannya tidak tersentuh.
  if (/^\s*(stop|berhenti|udahan|cukup)\b/i.test(pertanyaan) && window.UnaDispatcher?.cancelReads()) {
    cacaTambahGelembung('caca', 'Oke, Una berhenti menunggu bacaan itu, Bos. Draft yang ada tidak tersentuh.');
    cacaCatatRiwayat('una', 'Una berhenti menunggu bacaan halaman.');
    return;
  }

  cacaKonfigurasiWorkspace();
  cacaState.turnId = window.UnaDispatcher?.turn() || null;
  const turnId = cacaState.turnId;
  const workspaceContext = window.UnaWorkspace?.context();
  const scope = workspaceContext?.scope || cacaState.scope;
  // Jawaban Bos atas pertanyaan Una di tengah kerjaan ikut membawa catatan kerjanya.
  const tertunda = cacaState.kerjaTertunda && cacaState.kerjaTertunda.scope === scope ? cacaState.kerjaTertunda.kerja : null;
  cacaState.kerjaTertunda = null;
  // Tugas tertunda tetap dibawa walau gerai diganti: "pilih gerai dulu, lalu lanjut".
  const tugas = cacaState.tertunda;
  cacaState.analisisGiliran = cacaState.analisis && cacaState.analisisTersedia;
  cacaAturAnalisis(false);
  const mengetik = cacaTambahKerjaLive(cacaState.analisisGiliran ? 'Menganalisis dengan Claude Sonnet…' : undefined);
  const mulai = Date.now();
  try {
    const payload = await cacaTanyaSampaiTuntas(pertanyaan, scope, riwayat, tertunda, mengetik, tugas);
    const aksiUi = payload.uiActions?.length && window.UnaDispatcher;
    payload._pertanyaan = pertanyaan;
    // Jalur live dan aksi halaman tanpa jeda buatan: progresnya nyata.
    if (!aksiUi && !suaraKonteks?.suara) await cacaJedaManusiawi(mengetik, payload, mulai);
    payload._workspaceContext = workspaceContext || null;
    if (suaraKonteks) cacaMulutKonteks.set(payload, suaraKonteks);
    // Aksi halaman tidak ditunggu di sini: chat langsung bisa menerima koreksi ("eh sampai
    // tanggal 8") yang menggantikan bacaan yang masih berjalan.
    if (aksiUi) { void cacaJalankanAksiUi(payload, scope, mengetik, turnId, suaraKonteks, cacaState.konteksLembar); return; }
    mengetik.remove();
    const jenis = cacaTampilkanBalasanAgen(payload, pertanyaan, scope);
    if (jenis === 'rencana') await cacaMulaiRencana(payload.rencana, scope);
  } catch (error) {
    mengetik.remove();
    cacaTambahGelembung('caca', error.message);
  } finally {
    cacaState.analisisGiliran = false;
  }
}

// Tombol 🔬: hanya tampil bila tersedia; menekan = pesan berikutnya dikerjakan Claude Sonnet.
function cacaAturAnalisis(nyala) {
  cacaState.analisis = Boolean(nyala) && cacaState.analisisTersedia;
  const tombol = cacaEl('cacaAnalisis');
  if (!tombol) return;
  tombol.classList.toggle('hidden', !cacaState.analisisTersedia);
  tombol.setAttribute('aria-pressed', String(cacaState.analisis));
  tombol.classList.toggle('aktif', cacaState.analisis);
  const ketik = cacaEl('cacaPertanyaan');
  if (ketik) ketik.placeholder = cacaState.analisis ? 'Pesan untuk dianalisis Claude Sonnet' : 'Ketik pesan';
}

function cacaTerimaAnalisis(info) {
  cacaState.analisisTersedia = Boolean(info?.tersedia);
  cacaAturAnalisis(cacaState.analisis);
}

// U4 Una Live: jalankan uiActions lewat registry dan laporkan hasil dari tanda terimanya.
// Una tidak berkata "sudah tampil" sebelum tanda terima ok (contracts/una-live-workspace-v1.md 3.2).
async function cacaJalankanAksiUi(payload, scope, mengetik, turnId, suaraKonteks, basis = null) {
  const dispatcher = window.UnaDispatcher;
  let tanda = [];
  try {
    tanda = await dispatcher.run(payload.uiActions, {
      turnId, basis, question: payload._pertanyaan || '',
      onStep: ({ label, done }) => mengetik.aturLangkah?.(done.map(judul => ({ judul })), `${label}…`)
    });
  } finally {
    mengetik.remove();
  }
  const semuaOk = tanda.length > 0 && tanda.every(r => r.status === 'ok');
  // Halaman yang belum bisa jadi lembar (mis. menu gerai): kembali ke navigasi tab lama.
  if (!semuaOk && payload.alat === 'buka_layar' && payload.navigasi) {
    cacaTampilkanBalasanAgen({ ...payload, uiActions: null }, '', scope);
    return;
  }
  if (scope !== cacaState.scope) return;
  const hasil = dispatcher.conclude(tanda, payload);
  if (!hasil) return; // Digantikan perintah yang lebih baru; perintah itu yang melapor.
  const akhir = {
    ...payload, uiActions: null, jawaban: hasil.text, belumLengkap: hasil.ask, tawaran: hasil.tawaran || payload.tawaran || null,
    kerja: tanda.filter(r => r.status === 'ok').map(r => ({ alat: r.capabilityId, judul: r.label }))
  };
  if (suaraKonteks) cacaMulutKonteks.set(akhir, suaraKonteks);
  cacaTampilkanBalasan(akhir, scope);
  cacaSimpanPercakapan();
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
    const mengetik = cacaTambahKerjaLive(langkah.judul);
    let payload;
    try {
      payload = await cacaTanyaSampaiTuntas(langkah.perintah, rencana.scope, riwayat, null, mengetik);
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
  if (cacaState.sedangKirim || cacaSuara.sesi || !cacaState.siap || cacaSedangNgambek()) return;
  const input = cacaEl('cacaPertanyaan');
  const teks = input.value.trim();
  if (!cacaState.lampiran && !teks) return;

  cacaDiam();
  const suaraKonteks = { generasi: cacaMulutGenerasi, scope: cacaState.scope, login: cacaSidikLogin(), suara: cacaSuara.dariMikrofon };
  cacaSuara.dariMikrofon = false;
  cacaState.sedangKirim = true;
  cacaAturTombol();
  try {
    if (cacaState.lampiran) {
      await cacaKirimFoto();
    } else {
      input.value = '';
      cacaAturTinggiKetik();
      await cacaKirimTeks(teks, suaraKonteks);
    }
  } finally {
    cacaState.sedangKirim = false;
    cacaAturTombol();
    input.focus();
    if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-chat-idle'));
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
  window.UnaWorkspace?.reset();
  cacaSetTampil(false);
  cacaHapusSimpanan();
  const wadah = cacaEl('cacaPercakapan');
  if (wadah) wadah.innerHTML = '';
  cacaState.riwayat = [];
  cacaState.kerjaTertunda = null;
  cacaState.tertunda = null;
  cacaState.siapDipakai = false;
  cacaState.agen = CACA_AGEN_BAWAAN;
  cacaState.daftarAgen = [];
  cacaState.analisisTersedia = false;
  cacaAturAnalisis(false);
  cacaRenderPilihAgen();
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
  window.UnaWorkspace?.close();
  cacaHentikanSuara();
  if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-audio-stop'));
  cacaToggleDaftarGerai(false);
  cacaEl('cacaPanel')?.classList.add('hidden');
  cacaEl('cacaFab')?.setAttribute('aria-expanded', 'false');
}

// Bos Cyo 2026-10-05: "ukurannya engga konsisten, berubah2" dan "di hp tombol
// ganti gerai kadang ga keliatan". Dulu tinggi dihitung dari posisi bilah tab
// halaman — yang ikut bergeser kalau halamannya tergulir — jadi tiap kali dibuka
// ukurannya beda. Sekarang:
//   - layar lebar: ukuran tetap (maks 640px), hanya menyusut kalau jendela pendek;
//   - HP: penuh layar seperti WhatsApp, mengikuti bagian layar yang benar-benar
//     terlihat (visualViewport), jadi saat keyboard muncul kepala panel (nama
//     gerai + tombol ▾) tetap di atas dan hanya isi chat yang bergulir.
const CACA_LEBAR_HP = 560;

function cacaAturTinggiPanel() {
  const panel = cacaEl('cacaPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  const vv = window.visualViewport;
  if (window.innerWidth <= CACA_LEBAR_HP) {
    panel.style.top = `${Math.round(vv ? vv.offsetTop : 0)}px`;
    panel.style.height = `${Math.round(vv ? vv.height : window.innerHeight)}px`;
    return;
  }
  panel.style.top = '';
  panel.style.height = `${Math.min(640, Math.max(320, window.innerHeight - 120))}px`;
}

function cacaBukaPanel() {
  if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-profile-needed'));
  cacaKonfigurasiWorkspace();
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
  cacaEl('cacaStatus').textContent = masalah.length ? 'Una belum siap' : `${typeof cacaNamaAsisten === 'function' ? cacaNamaAsisten() : 'Una'} · siap membantu`;
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
  if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('caca-profile-needed'));
}

function initCacaPanel() {
  cacaPasangKerangka();
  if (cacaBolehDiWorkspace()) cacaSetTampil(true);
  cacaBukaLayarDariHash();
  cacaPasangMulut();
  cacaEl('cacaMikrofon')?.addEventListener('click', cacaToggleSuara);
  window.addEventListener('pagehide', cacaHentikanSuara);
  window.addEventListener('storage', event => { if (!event.key || event.key === 'lekerEntityAdminToken') cacaHentikanSuara(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cacaHentikanSuara();
  });
  if (!cacaPengenalSuara()) cacaStatusSuara('Browser ini belum mendukung input suara. Gunakan dikte keyboard atau ketik pesan.');
  cacaAturTombol();

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
  cacaEl('cacaWorkspaceToggle')?.addEventListener('click', () => { cacaKonfigurasiWorkspace(); if (window.UnaWorkspace?.isOpen) window.UnaWorkspace.close(); else window.UnaWorkspace?.open(); });
  cacaEl('cacaPilihGerai')?.addEventListener('click', () => cacaToggleDaftarGerai());
  cacaEl('cacaPilihAgen')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-caca-agen]');
    if (tab) cacaGantiAgen(tab.dataset.cacaAgen);
  });
  window.addEventListener('caca-agen-daftar', event => cacaTerimaDaftarAgen(event.detail?.agen));
  window.addEventListener('caca-analisis', event => cacaTerimaAnalisis(event.detail));
  cacaEl('cacaAnalisis')?.addEventListener('click', () => cacaAturAnalisis(!cacaState.analisis));

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
    if (event.defaultPrevented) return;
    const task = event.target.closest('[data-una-workspace-task]');
    if (task) { cacaKonfigurasiWorkspace(); window.UnaWorkspace?.open(task.dataset.unaWorkspaceTask); return; }
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
  window.visualViewport?.addEventListener('resize', cacaAturTinggiPanel);
  window.visualViewport?.addEventListener('scroll', cacaAturTinggiPanel);
}

window.cacaSetTampil = cacaSetTampil;
window.cacaLupakan = cacaLupakan;
document.addEventListener('DOMContentLoaded', initCacaPanel);
