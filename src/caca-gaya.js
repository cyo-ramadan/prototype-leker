// Gaya bicara Una (Bos Cyo 2026-10-02): jangan kaku. Sesekali "peh" (logat
// Tulungagung) kalau kerjaannya agak berat, kadang "wkwk", "ckck", "hhe".
//
// Bumbu ini hanya ditempel di kalimat yang disusun KODE (pertanyaan balik,
// laporan "sudah beres", hasil cek) — di batas API, bukan di dalam alat.
// Dua hal sengaja tidak pernah dibumbui:
//   - isi kartu draft: draft dicocokkan ulang huruf per huruf waktu "Ya"
//     ditekan (periksaUlangDraft), dan bumbu acak akan membuatnya ditolak;
//   - angka: bumbu hanya menempel di depan/belakang kalimat, tidak menyisip.
// Jawaban yang disusun model diatur lewat prompt (GAYA_UNTUK_MODEL), supaya
// tidak dibumbui dua kali.

const SUDAH_BERBUMBU = /\b(peh|wkwk+|ckck+|hhe+|hehe+)\b/i;

const BUMBU = Object.freeze({
  // Kerjaan agak berat: banyak gerai atau banyak baris sekaligus.
  berat: { peluang: 0.6, depan: ['Peh, lumayan juga ini.', 'Peh, kelar juga akhirnya.'] },
  // Sesuatu yang janggal atau tidak cocok.
  heran: { peluang: 0.4, depan: ['Ckck.'] },
  // Selesai dikerjakan.
  beres: { peluang: 0.4, belakang: [' hhe', ' wkwk', ' hhe 👌'] },
  // Una balik bertanya.
  tanya: { peluang: 0.25, belakang: [' hhe'] }
});

function pilih(daftar, acak) {
  return daftar[Math.min(daftar.length - 1, Math.floor(acak() * daftar.length))];
}

/**
 * @param {string} teks kalimat dari kode
 * @param {string[]} suasana urutan suasana, mis. ['berat', 'beres']
 * @param {() => number} [acak] diganti di test supaya hasilnya pasti
 */
export function bumbui(teks, suasana = [], acak = Math.random) {
  let hasil = String(teks ?? '');
  if (!hasil || SUDAH_BERBUMBU.test(hasil)) return hasil;
  let sudahDepan = false;
  let sudahBelakang = false;
  for (const nama of suasana) {
    const aturan = BUMBU[nama];
    if (!aturan || acak() >= aturan.peluang) continue;
    if (aturan.depan && !sudahDepan) {
      // Kalimat pembuka sendiri, kalimat aslinya tidak diubah sehuruf pun
      // (laporan per gerai diawali nama gerai yang huruf besarnya harus tetap).
      const depan = pilih(aturan.depan, acak);
      hasil = `${depan}${hasil.includes('\n') ? '\n' : ' '}${hasil}`;
      sudahDepan = true;
    }
    if (aturan.belakang && !sudahBelakang) {
      // Tanda titik di akhir dilepas dulu: "Sudah Una catat hhe" lebih wajar
      // daripada "Sudah Una catat. hhe".
      hasil = hasil.replace(/[.!]\s*$/, '') + pilih(aturan.belakang, acak);
      sudahBelakang = true;
    }
  }
  return hasil;
}

/**
 * Bumbu untuk jawaban /api/caca/tanya yang disusun kode. Draft tidak pernah
 * disentuh; kalau draftnya berat (banyak gerai/baris), bumbunya jadi kalimat
 * pengantar terpisah di luar draft.
 */
export function gayaJawaban(hasil, acak = Math.random) {
  if (hasil.draft) {
    const banyak = (hasil.draft.tabel?.isi?.length ?? 0) >= 3 || (hasil.draft.muatan?.langkah?.length ?? 0) >= 2;
    if (!banyak || acak() >= BUMBU.berat.peluang) return { jawaban: hasil.jawaban ?? null, sapaan: null };
    return { jawaban: hasil.jawaban ?? null, sapaan: pilih(['Peh, banyak juga ini. Una rangkum di bawah ya.', 'Peh, lumayan nih. Dicek dulu ya Bos.'], acak) };
  }
  // Jawaban yang disusun model sudah diatur gayanya lewat prompt.
  if (hasil.data !== undefined) return { jawaban: hasil.jawaban ?? null, sapaan: null };
  let suasana = ['tanya'];
  if (hasil.tabel) suasana = /belum cocok|beda/i.test(hasil.jawaban ?? '') ? ['heran'] : ['beres'];
  return { jawaban: bumbui(hasil.jawaban, suasana, acak), sapaan: null };
}

/** Bumbu laporan sesudah "Ya": banyak gerai = berat, lalu beres. */
export function gayaSelesai(jawaban, acak = Math.random) {
  const berat = String(jawaban ?? '').includes('\n');
  return bumbui(jawaban, berat ? ['berat', 'beres'] : ['beres'], acak);
}

export const GAYA_UNTUK_MODEL = [
  'Gaya bicara: santai dan akrab seperti teman kerja di kantor, bukan robot. Boleh sesekali',
  '"peh" (logat Tulungagung) kalau datanya banyak atau hasilnya bikin kaget, dan sesekali "wkwk",',
  '"ckck", atau "hhe" — paling banyak satu per jawaban, dan tidak di setiap jawaban.',
  'Jangan lebay, jangan pakai bahasa gaul lain yang dibuat-buat. Aturan angka di atas tetap nomor satu.'
].join('\n');
