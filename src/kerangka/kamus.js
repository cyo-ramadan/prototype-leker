// Kerangka kamus murni: isi, bahasa, dan konteks disuntikkan pemakai.
export const normalkanBaris = (isi) => String(isi ?? '').replace(/\r\n?/g, '\n');

export function dalamKonteks(entri, konteks = {}) {
  return Object.entries(konteks).every(([nama, nilai]) =>
    !Array.isArray(entri[nama]) || entri[nama].includes(nilai));
}

export function pilihVarian(entri, konteks = {}) {
  let hasil = entri;
  const nilai = Object.entries(konteks);
  for (const [nama, isi] of nilai) {
    const varian = entri.varian?.[nama]?.[isi] ?? (nilai.length === 1 ? entri.varian?.[isi] : null);
    if (varian) hasil = { ...hasil, ...varian };
  }
  return hasil;
}

export function peringkatKamus(teks, entri, { normalisasi, kata, konteks = {}, minimum = 2 } = {}) {
  if (typeof normalisasi !== 'function' || typeof kata !== 'function') throw new TypeError('Kamus memerlukan normalisasi dan pengenal kata.');
  const kalimat = ' ' + normalisasi(teks) + ' ';
  if (!kalimat.trim()) return [];
  const pertanyaan = kata(teks);
  return entri.filter((e) => dalamKonteks(e, konteks)).map((e) => {
    if (e.id === String(teks ?? '').trim()) return { entri: e, skor: 99 };
    let skor = 0;
    for (const kunci of e.kunci ?? []) {
      const k = normalisasi(kunci);
      if (k && kalimat.includes(' ' + k + ' ')) skor += 2 + k.split(' ').length;
    }
    const kosakata = kata([...(e.kunci ?? []), e.judul ?? ''].join(' '));
    for (const k of pertanyaan) if (kosakata.has(k)) skor += 1;
    return { entri: e, skor };
  }).filter((e) => e.skor >= minimum).sort((a, b) => b.skor - a.skor);
}

// Nama dan isi berkas terikat; urutan tidak berpengaruh. Hash disuntikkan pemakai.
export function bahanHashSumber(sumber, baca) {
  return [...new Set(sumber)].sort().map((nama) => nama + '\0' + normalkanBaris(baca(nama)) + '\0').join('');
}

export function periksaSumber(entri, { baca, hash }) {
  const masalah = [];
  for (const e of entri) {
    if (!Array.isArray(e.sumber)) { masalah.push(e.id + ': sumber belum ditulis'); continue; }
    if (!e.sumber.length) {
      if (!String(e.alasanTanpaSumber ?? '').trim()) masalah.push(e.id + ': sumber kosong tanpa alasan');
      continue;
    }
    try {
      if (e.diperiksa !== hash(bahanHashSumber(e.sumber, baca))) masalah.push(e.id + ': sumber berubah; tinjau penjelasannya');
    } catch (err) { masalah.push(e.id + ': ' + err.message); }
  }
  return masalah;
}

