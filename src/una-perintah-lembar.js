// U4 Una Live (contracts/una-live-workspace-v1.md bagian 3.3 dan 4.1): perintah lembar yang
// dikenali KODE, tanpa model. Contoh Bos Cyo 2026-10-15: "buka halaman laporan", lalu "ganti
// range tanggal 1 sampai 10 Oktober", lalu "eh sampai tanggal 8 aja". Model Una (lite) tidak
// andal menghitung tanggal, jadi tanggal dan koreksinya diterjemahkan di sini dan hasilnya
// berupa perintah kemampuan (uiActions) yang dijalankan registry di browser. Una baru boleh
// bilang "sudah tampil" setelah browser mengembalikan tanda terima ok.
//
// Konservatif: hanya pesan yang jelas tentang filter laporan yang diambil. Pertanyaan angka
// ("berapa omset ...") dan perintah tulis tetap ke alur agen biasa.

const BULAN = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
const POLA_BULAN = '(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|agt|ags|sep(?:t|tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)';
const SAMPAI = '(?:-|–|—|sampai|sampe|smp|s\\/d|sd|hingga|ke)';
const TGL = '(?:tanggal|tgl\\.?)?';
const MAKS_KONTEKS = 4096;
const TANGGAL_ISO = /^\d{4}-\d{2}-\d{2}$/;
const POLA_LEMBAR = /^(srf_[0-9a-f-]{36}|task:[\w-]{1,60})$/;
const STATUS = new Set(['ok', 'rejected', 'failed', 'stale', 'superseded', 'needs_clarification', 'cancelled']);

const pad = n => String(n).padStart(2, '0');
const normal = s => String(s ?? '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/\s+/g, ' ').trim();
const nomorBulan = teks => {
  const t = String(teks).toLowerCase();
  if (/^(agt|ags)$/.test(t)) return 8;
  const i = BULAN.findIndex(b => b.startsWith(t.slice(0, 3)));
  return i >= 0 ? i + 1 : null;
};

export function tanggalSah(iso) {
  if (!TANGGAL_ISO.test(String(iso ?? ''))) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function geser(tanggal, hari) {
  const [y, m, d] = tanggal.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari)).toISOString().slice(0, 10);
}
const selisihHari = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/** "1–10 Oktober 2026", "28 September – 5 Oktober 2026", "28 Desember 2025 – 5 Januari 2026". */
export function rentangUntukDibaca(dari, sampai) {
  const [y1, m1, d1] = dari.split('-').map(Number);
  const [y2, m2, d2] = sampai.split('-').map(Number);
  const nama = m => BULAN[m - 1][0].toUpperCase() + BULAN[m - 1].slice(1);
  if (dari === sampai) return `${d1} ${nama(m1)} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${nama(m2)} ${y2}`;
  if (y1 === y2) return `${d1} ${nama(m1)} – ${d2} ${nama(m2)} ${y2}`;
  return `${d1} ${nama(m1)} ${y1} – ${d2} ${nama(m2)} ${y2}`;
}

/**
 * Konteks lembar dari browser = data tak tepercaya. Bentuk tidak sah dibuang utuh (null),
 * giliran tetap jalan. Hanya petunjuk: lingkup/peran/pemilik tetap dari sesi.
 */
export function bersihkanKonteksLembar(mentah) {
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah)) return null;
  let teks;
  try { teks = JSON.stringify(mentah); } catch { return null; }
  if (teks.length > MAKS_KONTEKS) return null;
  const k = mentah;
  const bulat = v => Number.isSafeInteger(v) && v >= 0;
  const hasil = {
    conversationId: typeof k.conversationId === 'string' && k.conversationId.length <= 64 ? k.conversationId : null,
    turnId: typeof k.turnId === 'string' && /^turn_[\w-]{1,60}$/.test(k.turnId) ? k.turnId : null,
    scopeEpoch: bulat(k.scopeEpoch) ? k.scopeEpoch : null,
    activeSurfaceId: typeof k.activeSurfaceId === 'string' && POLA_LEMBAR.test(k.activeSurfaceId) ? k.activeSurfaceId : null,
    surfaceRevision: bulat(k.surfaceRevision) ? k.surfaceRevision : null,
    surfaceKind: ['task', 'page', 'canvas'].includes(k.surfaceKind) ? k.surfaceKind : null,
    page: null, filters: null, selection: null, lastAction: null
  };
  if (hasil.turnId === null || hasil.scopeEpoch === null) return null;
  if (k.page && ['entity', 'gerai'].includes(k.page.halaman) && /^[\w-]{1,40}$/.test(String(k.page.tab ?? ''))) hasil.page = { halaman: k.page.halaman, tab: k.page.tab };
  if (k.filters && typeof k.filters === 'object') {
    const f = {};
    if (tanggalSah(k.filters.from)) f.from = k.filters.from;
    if (tanggalSah(k.filters.to)) f.to = k.filters.to;
    if (Array.isArray(k.filters.stores) && k.filters.stores.length <= 100 && k.filters.stores.every(s => /^[A-Za-z0-9_-]{1,20}$/.test(String(s)))) f.stores = [...k.filters.stores];
    if (Object.keys(f).length) hasil.filters = f;
  }
  if (Array.isArray(k.selection) && k.selection.length <= 200 && k.selection.every(s => /^[\w-]{1,40}$/.test(String(s)))) hasil.selection = [...k.selection];
  const a = k.lastAction;
  if (a && /^[a-z]+\.[a-z_]+$/.test(String(a.capabilityId ?? '')) && STATUS.has(a.status)) {
    const ringkas = a.summary && typeof a.summary === 'object' && JSON.stringify(a.summary).length <= 2048 ? a.summary : {};
    hasil.lastAction = { capabilityId: a.capabilityId, status: a.status, summary: ringkas };
  }
  return hasil;
}

const PERAN = { 'ENTITY ADMIN': 'ENTITY_ADMIN', ENTITY_ADMIN: 'ENTITY_ADMIN', OWNER: 'OWNER', PEMILIK: 'OWNER' };

// Tahun dari filter lembar aktif bila ada, selain itu tahun berjalan Asia/Jakarta (kontrak 3.3).
function tahunAcuan(sc, hariIni) {
  const dari = sc?.filters?.from;
  return Number((dari && tanggalSah(dari) ? dari : hariIni).slice(0, 4));
}

/**
 * Menerjemahkan bagian tanggal pesan. Hasil: null (bukan soal tanggal),
 * { ok:true, from, to } atau { ok:false, tanya } (tanggal tidak sah / terbalik).
 */
export function uraiRentang(pesan, { sc = null, hariIni }) {
  const t = normal(pesan);
  const aktif = sc?.filters?.from && sc?.filters?.to ? sc.filters : null;
  const tahun = tahunAcuan(sc, hariIni);
  const tidakSah = 'Tanggal itu tidak ada di kalender, Bos. Maksudnya tanggal berapa?';
  const susun = (d1, m1, y1, d2, m2, y2) => {
    const dari = iso(y1, m1, d1);
    const sampai = iso(y2, m2, d2);
    if (!tanggalSah(dari) || !tanggalSah(sampai)) return { ok: false, tanya: tidakSah };
    if (dari > sampai) return { ok: false, tanya: `Tanggal mulai (${rentangUntukDibaca(dari, dari)}) sesudah tanggal akhir (${rentangUntukDibaca(sampai, sampai)}). Maksud Bos dari tanggal berapa sampai berapa?` };
    return { ok: true, from: dari, to: sampai };
  };

  // "1 sampai 10 oktober [2026]", "1 oktober sampai 10 oktober", "28 sept - 5 okt"
  let m = new RegExp(`\\b${TGL}\\s*(\\d{1,2})(?:\\s+${POLA_BULAN})?(?:\\s+(\\d{4}))?\\s*${SAMPAI}\\s*${TGL}\\s*(\\d{1,2})\\s+${POLA_BULAN}(?:\\s+(\\d{4}))?\\b`).exec(t);
  if (m) {
    const [, d1, b1, th1, d2, b2, th2] = m;
    const m2 = nomorBulan(b2);
    const m1 = b1 ? nomorBulan(b1) : m2;
    const y2 = th2 ? Number(th2) : th1 ? Number(th1) : tahun;
    // Melewati pergantian tahun tanpa tahun disebut: 28 Desember - 5 Januari.
    const y1 = th1 ? Number(th1) : (m1 > m2 ? y2 - 1 : y2);
    return susun(Number(d1), m1, y1, Number(d2), m2, y2);
  }
  // "tanggal 1 sampai 10" (bulan dari filter aktif, selain itu bulan berjalan)
  m = new RegExp(`\\b(?:tanggal|tgl\\.?)\\s*(\\d{1,2})\\s*${SAMPAI}\\s*${TGL}\\s*(\\d{1,2})\\b(?!\\s*(?:\\/|-|\\d))`).exec(t);
  if (m) {
    const acuan = aktif?.to || hariIni;
    const [y, bln] = acuan.split('-').map(Number);
    return susun(Number(m[1]), bln, y, Number(m[2]), bln, y);
  }
  // Koreksi satu ujung: "eh sampai tanggal 8 aja", "mulai tanggal 3", "dari tanggal 3 oktober".
  m = new RegExp(`\\b(sampai|sampe|hingga|mulai|dari|sejak)\\s+${TGL}\\s*(\\d{1,2})(?:\\s+${POLA_BULAN})?(?:\\s+(\\d{4}))?\\b`).exec(t);
  if (m && aktif) {
    const [, kata, hari, bln, th] = m;
    const ujung = /^(sampai|sampe|hingga)$/.test(kata) ? 'to' : 'from';
    const [ya, ma] = aktif[ujung].split('-').map(Number);
    const baru = iso(th ? Number(th) : ya, bln ? nomorBulan(bln) : ma, Number(hari));
    if (!tanggalSah(baru)) return { ok: false, tanya: tidakSah };
    const dari = ujung === 'from' ? baru : aktif.from;
    const sampai = ujung === 'to' ? baru : aktif.to;
    return susun(...dari.split('-').map(Number).reverse(), ...sampai.split('-').map(Number).reverse());
  }
  // Periode relatif.
  const awalBulan = d => d.slice(0, 8) + '01';
  if (/\bbulan ini\b/.test(t)) return { ok: true, from: awalBulan(hariIni), to: hariIni };
  if (/\bbulan (lalu|kemarin|sebelumnya)\b/.test(t) && !aktif) {
    const akhir = geser(awalBulan(hariIni), -1);
    return { ok: true, from: awalBulan(akhir), to: akhir };
  }
  if (/\bhari ini\b/.test(t)) return { ok: true, from: hariIni, to: hariIni };
  if (/\bkemarin\b/.test(t) && !/\bbulan kemarin\b/.test(t)) { const k = geser(hariIni, -1); return { ok: true, from: k, to: k }; }
  if (/\b(7 hari|seminggu|sepekan) terakhir\b/.test(t)) return { ok: true, from: geser(hariIni, -6), to: hariIni };
  // "kalau minggu sebelumnya?", "periode sebelumnya": geser rentang aktif mundur sepanjang rentangnya.
  if (aktif && /\b(minggu|pekan|periode|bulan) (sebelumnya|lalu|kemarin)\b/.test(t)) {
    if (/\bbulan\b/.test(t)) {
      const akhir = geser(awalBulan(aktif.from), -1);
      return { ok: true, from: awalBulan(akhir), to: akhir };
    }
    const panjang = selisihHari(aktif.from, aktif.to) + 1;
    return { ok: true, from: geser(aktif.from, -panjang), to: geser(aktif.to, -panjang) };
  }
  return null;
}

const KATA_TULIS = /\b(catat|bayar|tambah(?:kan|in)?|hapus|simpan|buat(?:kan|in)?|input|setor|beli|jual|transfer|posting|batalkan)\b/;
const KATA_TANYA_ANGKA = /\b(berapa|brp|jumlah(?:nya)?|total(?:nya)?)\b/;
const KATA_FILTER = /\b(ganti|ubah|set|atur|tampil(?:kan|in)?|lihat|liat|buka(?:kan|in)?|filter|range|rentang|periode|tanggal|tgl)\b/;
const KATA_KOREKSI = /^(eh|eits|ralat|maksudnya|maksud(?:ku|nya)?|bukan|salah|oh|kalau|kalo|gimana kalau|gimana kalo)\b/;

function perintah(capabilityId, params, sc, target = null) {
  return {
    actionId: 'act_' + globalThis.crypto.randomUUID(),
    turnId: sc.turnId,
    capabilityId, capabilityVersion: 1, params,
    // Target = lembar dan revisi yang Bos lihat saat mengirim pesan. Null hanya untuk perintah
    // yang didahului page.open di giliran yang sama; browser mengikatnya ke lembar hasil
    // page.open itu (public/una-dispatcher.js), bukan menebak revisi.
    target,
    scopeEpoch: sc.scopeEpoch,
    origin: 'code'
  };
}

/**
 * Perintah filter laporan Entity yang dikenali kode. null = bukan untuk modul ini
 * (lanjut ke buka_layar / agen biasa).
 */
export function perintahLembar(pesan, konteks = {}) {
  const sc = konteks.surfaceContext;
  if (!sc) return null; // Panel lama tanpa registry tidak bisa menjalankan uiActions.
  const peran = PERAN[String(konteks.peran ?? '').toUpperCase().replace(/_/g, ' ')] || PERAN[String(konteks.peran ?? '').toUpperCase()];
  const t = normal(pesan).replace(/^(una|maimunah|caca)\s*,?\s*/, '');
  if (!peran || KATA_TULIS.test(t) || KATA_TANYA_ANGKA.test(t)) return null;
  // Chat sedang membahas satu gerai: Laporan Usaha (semua gerai) ada di tingkat Entity.
  // Beri tahu, jangan diam-diam dilempar ke model atau membuka laporan gerai.
  if (konteks.lingkup !== 'entity') {
    const laporanEntity = /\blaporan\b/.test(t) && !/\blaporan (gerai|per gerai|stok|laci)\b/.test(t) && KATA_FILTER.test(t);
    if (!laporanEntity || !uraiRentang(t, { sc: null, hariIni: konteks.hariIni })) return null;
    return { ok: true, alat: 'ui_aksi', belumLengkap: true, uiActions: [], perluKonfirmasi: false,
      jawaban: 'Laporan Usaha untuk semua gerai ada di tingkat Entity, Bos. Pilih "Entity" di daftar gerai di atas chat, lalu ulangi perintahnya.' };
  }
  const laporanAktif = sc.page?.halaman === 'entity' && sc.page?.tab === 'reports';
  const sebutLaporan = /\blaporan\b/.test(t) && !/\blaporan (gerai|per gerai|stok|laci)\b/.test(t);
  if (!laporanAktif && !sebutLaporan) return null;
  if (!KATA_FILTER.test(t) && !KATA_KOREKSI.test(t) && !laporanAktif) return null;
  const rentang = uraiRentang(t, { sc: laporanAktif ? sc : null, hariIni: konteks.hariIni });
  if (!rentang) return null;
  if (!rentang.ok) {
    return { ok: true, alat: 'ui_aksi', jawaban: rentang.tanya, belumLengkap: true, uiActions: [], perluKonfirmasi: false };
  }
  const uiActions = [];
  // Laporan yang hanya terbuka di menu biasa (surfaceKind null) dipindah ke Workspace dulu,
  // karena set_filters mensyaratkan panel terpasang di lembar.
  const diWorkspace = laporanAktif && sc.surfaceKind === 'page' && sc.activeSurfaceId?.startsWith('srf_') && Number.isSafeInteger(sc.surfaceRevision) && sc.surfaceRevision >= 1;
  if (!diWorkspace) uiActions.push(perintah('page.open', { halaman: 'entity', tab: 'reports', display: 'workspace' }, sc));
  const target = diWorkspace ? { surfaceId: sc.activeSurfaceId, expectedRevision: sc.surfaceRevision } : null;
  uiActions.push(perintah('report.set_filters', { from: rentang.from, to: rentang.to }, sc, target));
  const dibaca = rentangUntukDibaca(rentang.from, rentang.to);
  return {
    ok: true, alat: 'ui_aksi',
    // Sementara: browser mengganti kalimat ini dengan hasil tanda terima.
    jawaban: `Una tampilkan laporan ${dibaca}, Bos.`,
    uiActions, rentang: { from: rentang.from, to: rentang.to, dibaca },
    perluKonfirmasi: false
  };
}
