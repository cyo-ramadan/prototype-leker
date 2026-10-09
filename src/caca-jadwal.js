// Pembaca jadwal kerja per hari dari kalimat Bos (Bos Cyo 2026-10-10: Una harus bisa
// MENGERJAKAN yang ia jelaskan — "Senin 09.00–22.00, Selasa sampai Sabtu 09.00–18.00,
// Minggu libur" adalah contoh di panduan akun CS). Dikerjakan kode, bukan model:
// model lite gampang menukar hari atau jam, dan jadwal yang salah langsung membuat
// CS tercatat telat.
//
// Bentuknya sama dengan body.schedule POST/PATCH /api/admin/cashiers
// (src/cashier-auth.js scheduleInput): 7 hari, dayOfWeek 0 = Minggu.
// Hari yang tidak disebut = null ("belum diatur" — bukan libur).

const HARI = Object.freeze([
  { pola: 'minggu|ahad', nomor: 0 },
  { pola: 'senin', nomor: 1 },
  { pola: 'selasa', nomor: 2 },
  { pola: 'rabu', nomor: 3 },
  { pola: 'kamis', nomor: 4 },
  { pola: "jum'?at", nomor: 5 },
  { pola: 'sabtu', nomor: 6 }
]);
export const NAMA_HARI = Object.freeze(['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']);
// Urutan tampil mulai Senin, sama dengan layar Akun Kasir.
export const URUT_TAMPIL = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

const KATA_HARI = new RegExp(`\\b(${HARI.map((h) => h.pola).join('|')})\\b`, 'gi');
const ADA_HARI = new RegExp(KATA_HARI.source, 'i');
const SEMUA_HARI = /\b(tiap|setiap|semua|seluruh)\s*hari(nya)?\b|\bsetiap\s*harinya\b/i;
const RENTANG = String.raw`\s*(?:-|–|—|s\/d|sd|sampai|sampe|hingga|ke|to)\s*`;
const JAM = String.raw`(?:jam\s*|pukul\s*)?(\d{1,2})(?:[.:](\d{2}))?`;
const RENTANG_JAM = new RegExp(`${JAM}${RENTANG}${JAM}(\\s*(?:sore|malam|malem|pm))?`, 'i');
const LIBUR = /\b(libur|off|tutup|tidak\s*masuk|ga+k?\s*masuk|nggak\s*masuk)\b/i;

function nomorHari(kata) {
  const k = kata.toLowerCase();
  return HARI.find((h) => new RegExp(`^(${h.pola})$`, 'i').test(k))?.nomor ?? null;
}

const duaDigit = (n) => String(n).padStart(2, '0');

function jamDari(m) {
  let mulai = Number(m[1]);
  const menitMulai = m[2] ? Number(m[2]) : 0;
  let selesai = Number(m[3]);
  const menitSelesai = m[4] ? Number(m[4]) : 0;
  const sore = Boolean(m[5]);
  if (mulai > 23 || selesai > 24 || menitMulai > 59 || menitSelesai > 59) return null;
  if (selesai === 24) selesai = 0;
  // "9 sampai 5 sore" / "jam 9-5": jam pulang 12-jam dinaikkan; "22-06" (shift malam) dibiarkan.
  if ((sore || selesai <= mulai) && selesai < 12 && selesai + 12 > mulai && selesai + 12 <= 23) selesai += 12;
  return { shiftStart: `${duaDigit(mulai)}:${duaDigit(menitMulai)}`, shiftEnd: `${duaDigit(selesai)}:${duaDigit(menitSelesai)}` };
}

/** Hari yang disebut di satu potongan kalimat ("senin sampai sabtu", "senin, rabu"). */
function hariDiPotongan(potongan) {
  if (SEMUA_HARI.test(potongan)) return [0, 1, 2, 3, 4, 5, 6];
  const temuan = [...potongan.matchAll(KATA_HARI)].map((m) => ({ nomor: nomorHari(m[1]), awal: m.index, akhir: m.index + m[0].length }));
  if (!temuan.length) return [];
  const hasil = new Set();
  for (let i = 0; i < temuan.length; i += 1) {
    const kini = temuan[i];
    const berikut = temuan[i + 1];
    const antara = berikut ? potongan.slice(kini.akhir, berikut.awal) : '';
    if (berikut && new RegExp(`^${RENTANG}$`, 'i').test(antara)) {
      // Rentang hari, boleh melewati Minggu ("jumat sampai senin").
      for (let n = kini.nomor; ; n = (n + 1) % 7) {
        hasil.add(n);
        if (n === berikut.nomor) break;
      }
      i += 1;
    } else {
      hasil.add(kini.nomor);
    }
  }
  return [...hasil];
}

/** Apakah kalimat ini menyebut jadwal (hari + jam/libur)? */
export function adaJadwal(teks) {
  const t = String(teks ?? '');
  return (ADA_HARI.test(t) || SEMUA_HARI.test(t)) && (RENTANG_JAM.test(t) || LIBUR.test(t));
}

/** Potongan kalimat yang berisi jadwal, mulai dari hari pertama yang disebut. */
export function potongJadwal(teks) {
  const t = String(teks ?? '').replace(/\s+/g, ' ').trim();
  if (!adaJadwal(t)) return '';
  const hari = t.search(ADA_HARI);
  const semua = t.search(SEMUA_HARI);
  const awal = [hari, semua].filter((n) => n >= 0).reduce((a, b) => Math.min(a, b), t.length);
  return t.slice(awal).slice(0, 400);
}

/**
 * @returns {{ok:true, hari:Array<null|{isDayOff:boolean, shiftStart:string, shiftEnd:string}>} | {ok:false, tanya:string}}
 * `hari[0]` = Minggu. null = tidak disebut.
 */
export function uraiJadwal(teks) {
  const t = String(teks ?? '').replace(/\s+/g, ' ').trim();
  const hari = [null, null, null, null, null, null, null];
  if (!t) return { ok: false, tanya: 'Jadwalnya hari apa saja, jam berapa sampai jam berapa?' };
  let menunggu = [];
  let adaIsi = false;
  for (const potongan of t.split(/[,;\n]|\s+(?:dan|terus|lalu|trus)\s+/i)) {
    const daftarHari = hariDiPotongan(potongan);
    const tanpaHari = potongan.replace(new RegExp(KATA_HARI.source, 'gi'), ' ').replace(SEMUA_HARI, ' ');
    const libur = LIBUR.test(tanpaHari);
    const m = tanpaHari.match(RENTANG_JAM);
    if (!daftarHari.length && !menunggu.length) continue;
    const sasaran = [...menunggu, ...daftarHari];
    if (libur) {
      for (const n of sasaran) hari[n] = { isDayOff: true, shiftStart: '', shiftEnd: '' };
      menunggu = []; adaIsi = true;
      continue;
    }
    if (m) {
      const jam = jamDari(m);
      if (!jam) return { ok: false, tanya: `Jam "${m[0].trim()}" belum kebaca. Tulis seperti 09.00-17.00 ya.` };
      for (const n of sasaran) hari[n] = { isDayOff: false, ...jam };
      menunggu = []; adaIsi = true;
      continue;
    }
    // "senin, rabu, jumat 09-17": hari tanpa jam menunggu jam di potongan berikutnya.
    menunggu = sasaran;
  }
  if (menunggu.length) {
    return { ok: false, tanya: `Hari ${menunggu.map((n) => NAMA_HARI[n]).join(', ')} jam berapa sampai jam berapa? Atau libur?` };
  }
  if (!adaIsi) return { ok: false, tanya: 'Jadwalnya belum kebaca. Tulis seperti "Senin–Sabtu 09.00–17.00, Minggu libur" ya.' };
  return { ok: true, hari };
}

/** Teks satu hari untuk draft. */
export function teksHari(h) {
  if (!h) return 'belum diatur';
  if (h.isDayOff) return 'Libur';
  if (!h.shiftStart && !h.shiftEnd) return 'belum diatur';
  return `${h.shiftStart}–${h.shiftEnd}`;
}

/** Bentuk body.schedule untuk endpoint Akun Kasir (hari null = belum diatur). */
export function keJadwalServer(hari) {
  return hari.map((h, dayOfWeek) => ({
    dayOfWeek,
    isDayOff: Boolean(h?.isDayOff),
    shiftStart: h && !h.isDayOff ? h.shiftStart : '',
    shiftEnd: h && !h.isDayOff ? h.shiftEnd : ''
  }));
}
