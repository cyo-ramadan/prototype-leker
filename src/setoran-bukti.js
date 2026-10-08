// Bukti transfer setoran CS -- Bos Cyo, 2026-10-08: "mulai pasang storage untuk simpan gambar ...
// bikin juga sistem yang misal cs upload itu foto detailnya bisa otomatis kebaca khususnya untuk hari
// jam menit penyetornya ... tapi kalo mau diisi manual cs ya gpp nanti di report ditulis isi manual.
// dan kedepannya aku pingin ini nanti langsung auto cek valid ... bikin pondasinya saja."
//
// Tiga bagian di sini, sengaja dipisah dari alur ACC (src/employee-deposit-settlement.js):
//   1. Penyimpanan foto: R2 (binding BUKTI_FOTO) bila terpasang, kalau belum tetap BLOB di D1
//      seperti sebelumnya. Membaca selalu mencoba keduanya, jadi foto lama tidak pernah hilang.
//   2. Baca otomatis isi foto (tanggal, jam:menit, nominal, bank, referensi) lewat lapisan AI yang
//      sama dengan Una (ADR-044, src/caca-ai-client.js). Hasilnya disimpan per sidik foto supaya
//      server -- bukan klien -- yang memutuskan waktu transfer itu OTOMATIS atau MANUAL.
//   3. Pondasi cek otomatis ke mutasi bank: fungsi pencocokan murni setoran vs baris mutasi
//      (bank_mutation_entries, migration 0142). Penyedia mutasinya belum dipilih (ADR-053).
import { callStructured } from './caca-ai-client.js';
import { jakartaWallClockToUtc } from './time.js';

export const BUKTI_SOURCE = Object.freeze({ OTOMATIS: 'OTOMATIS', MANUAL: 'MANUAL' });

// --- 1. Penyimpanan foto ------------------------------------------------------

export function r2Bucket(env) {
  const bucket = env?.BUKTI_FOTO;
  return bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function' ? bucket : null;
}

/**
 * Menyimpan foto. Mengembalikan isian kolom: { key } bila masuk R2, atau { bytes, type } untuk
 * BLOB D1. Kegagalan R2 jatuh ke D1 -- setoran CS tidak boleh gagal hanya karena storage.
 */
export async function simpanFotoBukti(env, { storeId, bytes, type }) {
  const bucket = r2Bucket(env);
  if (bucket) {
    const key = `setoran/${storeId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType: type || 'image/jpeg' } });
      return { key, type: type || 'image/jpeg', bytes: null };
    } catch (error) {
      console.error('R2 put bukti setoran gagal, simpan di D1', { storeId, error: String(error) });
    }
  }
  return { key: null, type, bytes };
}

/** row: { proof_photo, proof_photo_type, proof_photo_key } */
export async function bacaFotoBukti(env, row) {
  if (!row) return null;
  if (row.proof_photo_key) {
    const bucket = r2Bucket(env);
    const object = bucket ? await bucket.get(row.proof_photo_key) : null;
    if (object) return { body: object.body, type: object.httpMetadata?.contentType || row.proof_photo_type || 'image/jpeg' };
  }
  if (row.proof_photo) return { body: row.proof_photo, type: row.proof_photo_type || 'image/jpeg' };
  return null;
}

export async function sidikFoto(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// --- 2. Baca otomatis isi foto ------------------------------------------------

const SKEMA_BACAAN = {
  type: 'object',
  properties: {
    adalahBuktiTransfer: { type: 'boolean' },
    tanggal: { type: 'string', description: 'Tanggal transaksi pada bukti, format YYYY-MM-DD. Kosong bila tidak terbaca.' },
    jam: { type: 'string', description: 'Jam:menit transaksi pada bukti, 24 jam, format HH:MM, waktu Indonesia Barat. Kosong bila tidak terbaca.' },
    nominal: { type: 'integer', description: 'Nominal yang ditransfer dalam rupiah tanpa titik/koma. 0 bila tidak terbaca.' },
    bank: { type: 'string', description: 'Nama bank/dompet digital pengirim, mis. BCA, BRI, DANA. Kosong bila tidak terbaca.' },
    referensi: { type: 'string', description: 'Nomor referensi/ID transaksi. Kosong bila tidak ada.' },
    penerima: { type: 'string', description: 'Nama penerima pada bukti. Kosong bila tidak ada.' }
  },
  required: ['adalahBuktiTransfer', 'tanggal', 'jam', 'nominal', 'bank', 'referensi', 'penerima'],
  additionalProperties: false
};

const PROMPT_BACAAN = [
  'Kamu membaca FOTO/SCREENSHOT BUKTI TRANSFER uang dari aplikasi bank atau dompet digital Indonesia.',
  'Ambil persis yang tertulis; jangan menebak. Tanggal dan jam yang diminta adalah waktu transaksi pada bukti,',
  'bukan jam di status bar HP. Bila bukti memakai WITA/WIT, ubah jamnya ke WIB (WITA -1 jam, WIT -2 jam).',
  'Nominal ditulis angka rupiah bulat (Rp1.250.000 -> 1250000). Bila foto bukan bukti transfer, adalahBuktiTransfer=false.'
].join(' ');

const BULAN = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, aug: 8, sep: 9, september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12 };

export function normalisasiTanggal(value) {
  const text = String(value ?? '').trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return tanggalValid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return tanggalValid(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(text);
  if (m && BULAN[m[2]]) return tanggalValid(+m[3], BULAN[m[2]], +m[1]);
  return null;
}

function tanggalValid(year, month, day) {
  if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalisasiJam(value) {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?$/.exec(String(value ?? '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Waktu transfer WIB ("YYYY-MM-DD" + "HH:MM") -> ISO UTC, atau null bila tidak masuk akal:
 * tidak boleh di masa depan (toleransi 10 menit jam HP) dan tidak lebih tua dari 60 hari.
 */
export function waktuTransferIso(tanggal, jam, now = new Date()) {
  const date = normalisasiTanggal(tanggal);
  const clock = normalisasiJam(jam);
  if (!date || !clock) return null;
  const utc = jakartaWallClockToUtc(date, clock);
  if (!utc) return null;
  const selisih = now.getTime() - utc.getTime();
  if (selisih < -10 * 60 * 1000 || selisih > 60 * 24 * 60 * 60 * 1000) return null;
  return utc.toISOString();
}

/** Mengubah jawaban mesin baca menjadi bentuk yang dipakai sistem (semua bidang boleh kosong). */
export function rapikanBacaan(value, now = new Date()) {
  const tanggal = normalisasiTanggal(value?.tanggal);
  const jam = normalisasiJam(value?.jam);
  const nominal = Number.isSafeInteger(Number(value?.nominal)) && Number(value.nominal) > 0 ? Number(value.nominal) : null;
  const transferAt = tanggal && jam ? waktuTransferIso(tanggal, jam, now) : null;
  return {
    adalahBuktiTransfer: value?.adalahBuktiTransfer !== false,
    tanggal: transferAt ? tanggal : null,
    jam: transferAt ? jam : null,
    transferAt,
    nominalRupiah: nominal,
    bank: String(value?.bank ?? '').trim().slice(0, 60),
    referensi: String(value?.referensi ?? '').trim().slice(0, 80),
    penerima: String(value?.penerima ?? '').trim().slice(0, 80)
  };
}

function bytesToBase64(bytes) {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Membaca foto lewat lapisan AI. { ok, bacaan } atau { ok:false, status, error }. */
export async function bacaBuktiTransfer(env, { bytes, type }, { now = new Date(), call = callStructured } = {}) {
  const hasil = await call(env, {
    system: PROMPT_BACAAN,
    content: [
      { type: 'image', mediaType: type || 'image/jpeg', data: bytesToBase64(bytes) },
      { type: 'text', text: 'Baca bukti transfer ini.' }
    ],
    schema: SKEMA_BACAAN,
    maxTokens: 600
  });
  if (!hasil?.ok) return { ok: false, status: hasil?.status || 502, error: hasil?.error || 'Foto belum bisa dibaca otomatis.' };
  return { ok: true, bacaan: rapikanBacaan(hasil.value, now) };
}

export async function simpanBacaan(db, { photoSha256, storeId, cashierId, bacaan }) {
  await db.prepare(`
    INSERT INTO setoran_bukti_bacaan (photo_sha256, store_id, cashier_id, result_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (photo_sha256, cashier_id) DO UPDATE SET result_json = excluded.result_json, store_id = excluded.store_id
  `).bind(photoSha256, storeId, cashierId, JSON.stringify(bacaan)).run();
}

export async function ambilBacaan(db, { photoSha256, cashierId }) {
  const row = await db.prepare(`
    SELECT result_json FROM setoran_bukti_bacaan WHERE photo_sha256 = ? AND cashier_id = ? LIMIT 1
  `).bind(photoSha256, cashierId).first();
  if (!row) return null;
  try { return JSON.parse(row.result_json); } catch { return null; }
}

/**
 * Menentukan waktu transfer yang disimpan dan asalnya. Asal OTOMATIS hanya bila server sendiri
 * pernah membaca foto yang SAMA (sidik sama) dan waktu yang dikirim persis hasil bacaan itu.
 * input: { tanggal, jam } dari isian CS (WIB).
 */
export function tetapkanWaktuTransfer({ tanggal, jam }, bacaan, now = new Date()) {
  const transferAt = waktuTransferIso(tanggal, jam, now);
  if (!transferAt) return { transferAt: null, source: '' };
  const otomatis = Boolean(bacaan?.transferAt) && bacaan.transferAt === transferAt;
  return { transferAt, source: otomatis ? BUKTI_SOURCE.OTOMATIS : BUKTI_SOURCE.MANUAL };
}

// --- 3. Pondasi cek otomatis ke mutasi bank ------------------------------------

/**
 * Mencari baris mutasi MASUK yang cocok dengan satu setoran: nominal persis sama dan waktu mutasi
 * dalam jendela waktu dari waktu transfer (default 60 menit; penyedia mutasi umumnya mengecek per
 * 15 menit). Mutasi yang sudah dipasangkan ke setoran lain tidak dipakai lagi. Mengembalikan
 * { status: 'COCOK', mutation } bila tepat satu kandidat, 'GANDA' bila lebih dari satu (perlu
 * Admin), 'TIDAK_ADA' bila belum ada. Murni -- tidak menyentuh database.
 */
export function cocokkanMutasi(payment, mutations, { windowMinutes = 60 } = {}) {
  const amountScaled = Number(payment?.amountScaled);
  const at = Date.parse(payment?.transferAt || payment?.createdAt || '');
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0 || Number.isNaN(at)) return { status: 'TIDAK_ADA', mutation: null };
  const jendela = windowMinutes * 60 * 1000;
  const kandidat = (mutations || []).filter(row => row.direction === 'IN'
    && !row.matched_payment_id
    && Number(row.amount_scaled) === amountScaled
    && Math.abs(Date.parse(row.occurred_at) - at) <= jendela);
  if (kandidat.length === 1) return { status: 'COCOK', mutation: kandidat[0] };
  if (kandidat.length > 1) return { status: 'GANDA', mutation: null, candidates: kandidat };
  return { status: 'TIDAK_ADA', mutation: null };
}

