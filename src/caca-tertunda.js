// Tugas tertunda: Una tidak lupa apa yang sedang dikerjakan (Bos Cyo 2026-10-09).
//
// Kejadiannya: "bikin barang tutup cup manual, harganya 12rb dapet 50 pcs" →
// Una bertanya → Bos menjawab "tutup cup manual", "harga jualnya 120", "5000" —
// dan tiap jawaban dibaca ulang dari nol oleh model, kehilangan isian sebelumnya
// (bahkan "5000" dikira perintah mengubah barang lain). Riwayat obrolan saja
// tidak cukup: model kecil membaca riwayat tapi tetap lupa menyalin isiannya.
//
// Jadi keadaan tugasnya disimpan TERSTRUKTUR, bukan dititipkan ke ingatan model:
//   { alat, tangkapan (isian sejauh ini), tanya (pertanyaan Una), kurang (kolom
//     yang ditanyakan) }
// Panel menyimpannya dan mengirimnya bersama pesan Bos berikutnya. Kode lalu:
//   1. "batal/gajadi" → tugas dilepas;
//   2. "ga jelas / maksudnya?" → Una menjelaskan ulang tugasnya dan yang kurang;
//   3. jawaban pendek tanpa kata perintah baru → dipastikan untuk tugas ini;
//   4. isian lama DIGABUNG dengan isian baru (yang baru menang kalau terisi), dan
//      kolom yang ditanyakan diisi langsung dari jawaban Bos kalau model lupa.
// Sama seperti riwayat, data ini datang dari browser = tak tepercaya: dibersihkan
// di sini, dan tetap berakhir di draft + "Ya" yang diperiksa ulang server.

export const MAKS_JAWABAN_PENDEK = 80;
const MAKS_TEKS_ISIAN = 2000;
const MAKS_JSON_TANGKAPAN = 20000;

const BATAL = /^\s*(batal(in|kan)?|ga+k?\s*jadi|gajadi|nggak\s*jadi|enggak\s*jadi|cancel|udah(an)?\s*(deh|aja)?|stop)\b/i;
const BINGUNG = /\b(ga+k?\s*(jelas|ngerti|paham)|nggak\s*(jelas|ngerti|paham)|bingung|maksud(nya)?\s*(apa|gimana)?\s*\??$|gimana\s*sih|apaan|ngomong\s*apa)\b/i;
// Kata yang menandai PERINTAH BARU, bukan jawaban atas pertanyaan Una.
const KATA_PERINTAH = /\b(bikin|buat(in|kan)?|tambah(in|kan)?|masukin|ubah|ganti|hapus|matiin|nonaktif\w*|cek|lihat|liat|catat|bayar|koreksi|hitung|untung|stok|laporan|jurnal|sinkron\w*)\b/i;
const NOMINAL = /(?:rp\.?\s*)?\d[\d.,]*\s*(?:rb|ribu|k|jt|juta)?(?![\w])/i;

/**
 * @param {unknown} masuk tugas tertunda kiriman browser
 * @param {(alat:string) => string[]|null} kolomAlat nama kolom sah untuk alat itu (null = alat tidak dikenal)
 */
export function bersihkanTertunda(masuk, kolomAlat) {
  if (!masuk || typeof masuk !== 'object') return null;
  const alat = String(masuk.alat ?? '').replace(/[^a-z_]/g, '').slice(0, 40);
  const kolom = alat ? kolomAlat(alat) : null;
  if (!kolom) return null;
  const tangkapan = {};
  const sumber = masuk.tangkapan && typeof masuk.tangkapan === 'object' ? masuk.tangkapan : {};
  for (const k of kolom) {
    const v = sumber[k];
    if (v == null || v === '') continue;
    if (typeof v === 'string') tangkapan[k] = v.slice(0, MAKS_TEKS_ISIAN);
    else if (typeof v === 'boolean' || typeof v === 'number') tangkapan[k] = v;
    else if (Array.isArray(v) || typeof v === 'object') tangkapan[k] = v;
  }
  let ukuran = 0;
  try { ukuran = JSON.stringify(tangkapan).length; } catch { return null; }
  if (ukuran > MAKS_JSON_TANGKAPAN) return null;
  const kurang = kolom.includes(masuk.kurang) ? masuk.kurang : null;
  const tanya = String(masuk.tanya ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { alat, tangkapan, tanya, kurang };
}

export const mintaBatal = (pesan) => BATAL.test(String(pesan ?? ''));
export const terdengarBingung = (pesan) => BINGUNG.test(String(pesan ?? '')) && !NOMINAL.test(String(pesan ?? ''));

/** Pesan pendek tanpa perintah baru = jawaban atas pertanyaan Una. */
export function jawabanPendek(pesan) {
  const teks = String(pesan ?? '').trim();
  // Pertanyaan balik ("harga es teh berapa?") juga bukan jawaban.
  return teks.length > 0 && teks.length <= MAKS_JAWABAN_PENDEK && !KATA_PERINTAH.test(teks)
    && !/\?\s*$/.test(teks) && !/\b(berapa|siapa|kapan|kenapa|mana)\b/i.test(teks);
}

const kosong = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Isian lama + isian baru.
 *   timpa (pesan lengkap/perintah ulang): yang baru menang kalau terisi;
 *   lengkapi (jawaban pendek): isian lama TIDAK ditimpa — "5000" yang menjawab
 *   harga jual tidak boleh menimpa harga beli yang sudah disebut.
 */
export function gabungTangkapan(lama, baru, kolom, { lengkapi = false } = {}) {
  const hasil = {};
  for (const k of kolom) {
    const b = baru?.[k];
    const l = lama?.[k];
    if (lengkapi) {
      if (!kosong(l)) hasil[k] = l;
      else if (!kosong(b)) hasil[k] = b;
    } else if (!kosong(b)) hasil[k] = b;
    else if (!kosong(l)) hasil[k] = l;
  }
  return hasil;
}

export { kosong as isianKosong };

/**
 * Mengisi kolom yang ditanyakan langsung dari jawaban Bos. Kolom harga/nominal
 * mengambil angka pertama di jawaban ("harga jualnya 120" → "120"); kolom lain
 * mengambil jawabannya, dibuang awalan basa-basinya ("namanya tutup cup" → "tutup cup").
 */
export function isiKolomDariJawaban(kurang, pesan) {
  const teks = String(pesan ?? '').trim();
  if (!kurang || !teks) return null;
  if (/(_harga_|harga$|nominal|_qty|_isi$)/.test(kurang)) {
    const m = teks.match(NOMINAL);
    return m ? m[0].trim() : null;
  }
  const bersih = teks
    .replace(/^(nama\s*(barang)?(nya)?|namanya|barangnya|kategori(nya)?|satuan(nya)?)\s*(itu|adalah|:|=)?\s*/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  return bersih || null;
}

/** Blok konteks untuk model: tugas apa yang sedang dikerjakan dan yang kurang. */
export function teksTertunda(t) {
  if (!t) return '';
  return [
    `TUGAS YANG SEDANG UNA KERJAKAN: alat ${t.alat}. Isian sejauh ini: ${JSON.stringify(t.tangkapan)}.`,
    t.tanya ? `Una tadi bertanya: "${t.tanya}"` : '',
    'Kalau pesan Bos menjawab pertanyaan itu atau melengkapi isian, pilih alat yang sama dan isi SEMUA kolomnya',
    '(isian sejauh ini + jawaban Bos). Pilih alat lain hanya kalau Bos jelas memberi perintah baru.',
    '---'
  ].filter(Boolean).join('\n');
}

const LABEL_KOLOM = Object.freeze({
  barang_nama: 'nama', barang_harga_jual: 'harga jual', barang_harga_beli: 'harga beli', barang_isi: 'isi per kemasan',
  barang_kategori: 'kategori', barang_satuan: 'satuan'
});

/** Penjelasan ulang yang ramah saat Bos bingung: tugasnya apa, sudah ada apa, kurang apa. */
export function jelaskanTertunda(t) {
  const sudah = Object.entries(t.tangkapan)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => `${LABEL_KOLOM[k] ?? k.replace(/^[a-z]+_/, '').replace(/_/g, ' ')}: ${v}`);
  return [
    'Maaf bikin bingung, Bos.',
    `Una lagi ngerjain ${t.alat.replace(/_/g, ' ')}${sudah.length ? ` (yang sudah ada — ${sudah.join(', ')})` : ''}.`,
    t.tanya ? `Yang masih kurang: ${t.tanya}` : 'Tinggal Bos lengkapi sedikit lagi.',
    'Atau bilang "batal" kalau nggak jadi.'
  ].join(' ');
}
