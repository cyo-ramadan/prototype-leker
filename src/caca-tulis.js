// Alat TULIS pertama Caca: mencatat pengeluaran operasional (ADR-045 Tahap B).
//
// Hemat kuota bukan datang dari memilih model murah — itu cuma bonus. Datang
// dari tidak memanggil AI di langkah yang tidak butuh memahami bahasa. Satu
// perintah = SATU panggilan AI:
//
//   1. AI menangkap maksud dari kalimat bebas          <- satu-satunya panggilan
//   2. Kode mengurai nominal, melengkapi, memeriksa    <- tanpa AI
//   3. Kode menyusun draft beserta dampaknya           <- tanpa AI
//   4. Orang menekan tombol Ya                         <- tanpa AI
//   5. Kode memposting lewat endpoint yang sama        <- tanpa AI
//
// Bandingkan dengan menyerahkan tiap langkah ke AI: 4-5 panggilan untuk satu
// pencatatan, dan tiap panggilan tambahan adalah kesempatan tambahan baginya
// untuk mengarang angka.

import { uraikanNominal, rupiah } from './caca-nominal.js';
import { getJakartaBusinessDate } from './time.js';

const ENDPOINT = '/api/admin/operational-expenses';
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

// Jenis yang Caca layani sekarang baru satu. Bea Gaji wajib menunjuk karyawan
// nyata dan Bea Lapak lewat supplier terdaftar — dua-duanya butuh pencocokan ke
// master, yang jadi pekerjaan tersendiri. Lebih baik satu jenis yang tuntas
// daripada tiga yang setengah jalan.
export const JENIS_DILAYANI = Object.freeze(['BEA_LAINNYA']);

export const TANGKAP_PENGELUARAN_SCHEMA = Object.freeze({
  type: 'object',
  required: ['keterangan', 'nominal_tertulis'],
  properties: {
    keterangan: { type: 'string', description: 'Pengeluarannya untuk apa, mis. "beli gas".' },
    nominal_tertulis: {
      type: 'string',
      description: 'Potongan nominal PERSIS seperti diucapkan, mis. "22rb" atau "1,5jt". Jangan dihitung sendiri.'
    },
    pihak_tertulis: { type: 'string', description: 'Nama orang atau tempat yang dibayari, kalau disebut.' },
    tanggal_tertulis: { type: 'string', description: 'YYYY-MM-DD, hanya kalau penanya menyebut tanggal tertentu.' }
  }
});

export const TANGKAP_PENGELUARAN_PROMPT = [
  'Kamu Maimunah, asisten toko yang biasa dipanggil Una. Sebut dirimu "Una", bukan "saya" atau "aku". Tugasmu di langkah ini cuma menyalin isi perintah jadi data.',
  '',
  'Aturan keras:',
  '- Salin nominal PERSIS seperti diucapkan. "22rb" ditulis "22rb", bukan 22000 dan bukan 22.',
  '- Jangan menghitung, jangan mengubah satuan, jangan membulatkan.',
  '- Yang tidak disebut dikosongkan. Jangan diisi tebakan.',
  '- Jangan menghitung tanggal sendiri. Isi tanggal hanya kalau penanya menyebut tanggal tertentu.'
].join('\n');

/**
 * Menyiapkan draft dari tangkapan model. Tidak memanggil AI dan tidak menyentuh
 * data — murni memeriksa dan menyusun.
 *
 * @returns {{ok:true, draft:object} | {ok:false, tanya:string}}
 */
export function siapkanDraftPengeluaran(tangkapan, { hariIni = getJakartaBusinessDate() } = {}) {
  const keterangan = String(tangkapan?.keterangan ?? '').trim().slice(0, 220);
  if (!keterangan) return { ok: false, tanya: 'Pengeluarannya buat apa ya?' };

  const nominal = uraikanNominal(tangkapan?.nominal_tertulis);
  if (!nominal.ok) return { ok: false, tanya: nominal.tanya };
  if (nominal.nilai < 0) return { ok: false, tanya: 'Nominalnya minus. Maksudnya pengeluaran berapa?' };

  // Endpoint Bea Operasional mewajibkan pihak yang dihutangi untuk jenis ini.
  const pihak = String(tangkapan?.pihak_tertulis ?? '').trim().slice(0, 200);
  if (!pihak) return { ok: false, tanya: `"${keterangan}" ${rupiah(nominal.nilai)} ini dibayarkan ke siapa?` };

  const tanggalDisebut = String(tangkapan?.tanggal_tertulis ?? '').trim();
  if (tanggalDisebut && !TANGGAL.test(tanggalDisebut)) {
    return { ok: false, tanya: 'Tanggalnya belum jelas. Tanggal berapa ya?' };
  }
  const tanggal = tanggalDisebut || hariIni;
  if (tanggal > hariIni) return { ok: false, tanya: 'Tanggalnya di masa depan. Maksudnya tanggal berapa?' };

  return {
    ok: true,
    draft: {
      jenis: 'BEA_LAINNYA',
      keterangan,
      nominal: nominal.nilai,
      pihak,
      tanggal,
      // Dampak, bukan pengulangan perintah. Orang berhenti waktu melihat akibat
      // yang tidak dia duga — bukan waktu melihat kalimatnya sendiri diulang.
      // Yang paling sering tidak diduga di sini: ini tercatat sebagai HUTANG,
      // bukan uang tunai yang sudah keluar.
      dampak: [
        `Tercatat sebagai hutang ke ${pihak} sebesar ${rupiah(nominal.nilai)}.`,
        `Masuk Bea Operasional gerai, tanggal ${tanggal}.`,
        'Belum ada uang yang keluar — pelunasannya dicatat terpisah.'
      ]
    }
  };
}

/** Bentuk permintaan ke endpoint aslinya. Dipisah supaya bisa diperiksa tanpa mengirim apa pun. */
export function bangunPermintaanPengeluaran(draft, { request, storeCode }) {
  const url = new URL(ENDPOINT, 'https://leker.internal');
  if (storeCode) url.searchParams.set('store', storeCode);

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      category: draft.jenis,
      description: draft.keterangan,
      amount: draft.nominal,
      counterpartyType: 'OTHER',
      counterpartyName: draft.pihak,
      businessDate: draft.tanggal
    })
  });
}

/**
 * Memposting draft lewat endpoint yang sama dengan yang dipakai panel Admin,
 * membawa kredensial penyuruh (K1/K4 ADR-045). Validasi, jurnal, dan pencatatan
 * hutangnya jalan di sana — tidak ditulis ulang di sini.
 */
export async function postingPengeluaran(draft, { request, env, storeCode, handler }) {
  const permintaan = bangunPermintaanPengeluaran(draft, { request, storeCode });
  const response = await handler(permintaan, env, ENDPOINT);
  if (!response) return { ok: false, error: 'Jalur pencatatan tidak menjawab.' };

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'Jawaban jalur pencatatan tidak terbaca.' };
  }

  if (!response.ok) return { ok: false, error: data?.error || 'Pencatatan ditolak.', status: response.status };
  return { ok: true, data };
}
