// Mesin hitung untuk Una — "model menyalin, kode menghitung" (ADR-044/045).
//
// Una boleh membaca banyak data, tapi tidak pernah menjumlahkan, membandingkan,
// atau mengurutkan angka sendiri: model hanya menyebut MAUNYA ("barang yang HPP-nya
// di atas harga jual, urut selisih terbesar"), dan fungsi-fungsi di sini yang
// mengerjakannya. Angka yang sampai ke layar berasal dari sini.
//
// Uang tidak pernah float (invariant #1): semua angka dibaca ke bilangan bulat
// skala 1.000.000 (BigInt), dijumlah/dikurang persis, dan dibagi/dikali dengan
// pembulatan half-up di digit ke-7. Float JS hanya dipakai untuk membaca teks
// angka yang sudah punya maksimal 6 desimal.

const SKALA = 1_000_000n;
export const MAKS_BARIS_TAMPIL = 50;
export const MAKS_BARIS_BACA = 20_000;

// --- angka skala ------------------------------------------------------------

/** "12.5" / 12.5 / "12" -> BigInt skala; bukan angka -> null. */
export function keSkala(nilai) {
  if (typeof nilai === 'bigint') return nilai * SKALA;
  let teks;
  if (typeof nilai === 'number') {
    if (!Number.isFinite(nilai)) return null;
    teks = String(nilai);
  } else if (typeof nilai === 'string') {
    teks = nilai.trim();
  } else {
    return null;
  }
  // Notasi eksponen (1e-7) tidak dikenal: nilai sekecil itu bukan rupiah.
  const cocok = teks.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!cocok) return null;
  const [, minus, bulat, desimal = ''] = cocok;
  const tujuh = desimal.padEnd(7, '0').slice(0, 7);
  let skala = BigInt(bulat) * SKALA + BigInt(tujuh.slice(0, 6));
  if (Number(tujuh[6]) >= 5) skala += 1n; // half-up di digit ke-7
  return minus ? -skala : skala;
}

/** BigInt skala -> teks angka, desimal dipangkas nol di belakang. */
export function dariSkala(skala) {
  const minus = skala < 0n;
  const abs = minus ? -skala : skala;
  const bulat = abs / SKALA;
  const sisa = abs % SKALA;
  const desimal = sisa ? `.${sisa.toString().padStart(6, '0').replace(/0+$/, '')}` : '';
  return `${minus ? '-' : ''}${bulat}${desimal}`;
}

/** Untuk tampilan: pemisah ribuan gaya Indonesia, koma desimal. */
export function tampilSkala(skala) {
  const teks = dariSkala(skala);
  const minus = teks.startsWith('-');
  const [bulat, desimal] = (minus ? teks.slice(1) : teks).split('.');
  const ribuan = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${minus ? '−' : ''}${ribuan}${desimal ? `,${desimal}` : ''}`;
}

function bagiHalfUp(pembilang, penyebut) {
  if (penyebut === 0n) return null;
  const tandaMinus = (pembilang < 0n) !== (penyebut < 0n);
  const a = pembilang < 0n ? -pembilang : pembilang;
  const b = penyebut < 0n ? -penyebut : penyebut;
  let hasil = a / b;
  if ((a % b) * 2n >= b) hasil += 1n;
  return tandaMinus ? -hasil : hasil;
}

// --- membaca kolom ----------------------------------------------------------

/** Kolom bertitik ("barang.nama"); nama kolom dicocokkan persis, lalu tanpa beda huruf besar. */
export function ambilKolom(baris, kolom) {
  let sekarang = baris;
  for (const bagian of String(kolom).split('.')) {
    if (sekarang === null || typeof sekarang !== 'object') return undefined;
    if (Object.hasOwn(sekarang, bagian)) {
      sekarang = sekarang[bagian];
      continue;
    }
    const mirip = Object.keys(sekarang).find((k) => k.toLowerCase() === bagian.toLowerCase());
    if (mirip === undefined) return undefined;
    sekarang = sekarang[mirip];
  }
  return sekarang;
}

function angkaDariSel(sel) {
  return keSkala(sel);
}

// --- kolom turunan ----------------------------------------------------------

const OPERASI = Object.freeze({
  kurang: (a, b) => a - b,
  tambah: (a, b) => a + b,
  kali: (a, b) => bagiHalfUp(a * b, SKALA),
  bagi: (a, b) => bagiHalfUp(a * SKALA, b),
  persen_dari: (a, b) => bagiHalfUp(a * 100n * SKALA, b)
});

export const NAMA_OPERASI = Object.freeze(Object.keys(OPERASI));

function nilaiOperand(baris, kolom) {
  const sel = ambilKolom(baris, kolom);
  if (sel === undefined || sel === null || sel === '') return null;
  if (typeof sel === 'boolean') return null;
  return angkaDariSel(sel);
}

/**
 * @param {object[]} baris
 * @param {{nama:string, kolom_a:string, operasi:string, kolom_b:string}[]} turunan
 * @returns {{ok:true, baris:object[]} | {ok:false, error:string}}
 */
export function tambahTurunan(baris, turunan = []) {
  const hasil = baris.map((b) => ({ ...b }));
  for (const t of turunan) {
    const nama = String(t?.nama ?? '').trim();
    const fungsi = OPERASI[t?.operasi];
    if (!nama || !/^[\p{L}\p{N}_ ]{1,40}$/u.test(nama)) return { ok: false, error: `Nama kolom turunan "${nama}" tidak valid.` };
    if (!fungsi) return { ok: false, error: `Operasi "${t?.operasi}" tidak dikenal. Pilihan: ${NAMA_OPERASI.join(', ')}.` };
    for (const b of hasil) {
      const a = nilaiOperand(b, t.kolom_a);
      const c = nilaiOperand(b, t.kolom_b);
      const nilai = a === null || c === null ? null : fungsi(a, c);
      b[nama] = nilai === null || nilai === undefined ? null : dariSkala(nilai);
    }
  }
  return { ok: true, baris: hasil };
}

// --- menyaring --------------------------------------------------------------

export const NAMA_OP_SARING = Object.freeze(['sama', 'beda', 'lebih_dari', 'min_sama', 'kurang_dari', 'maks_sama', 'mengandung', 'kosong', 'ada']);

function bandingkan(sel, op, tujuan) {
  if (op === 'kosong') return sel === undefined || sel === null || sel === '';
  if (op === 'ada') return !(sel === undefined || sel === null || sel === '');
  if (sel === undefined || sel === null) return false;

  if (op === 'mengandung') return String(sel).toLowerCase().includes(String(tujuan ?? '').toLowerCase());

  const a = angkaDariSel(sel);
  const b = angkaDariSel(tujuan);
  if (a !== null && b !== null) {
    switch (op) {
      case 'sama': return a === b;
      case 'beda': return a !== b;
      case 'lebih_dari': return a > b;
      case 'min_sama': return a >= b;
      case 'kurang_dari': return a < b;
      case 'maks_sama': return a <= b;
      default: return false;
    }
  }
  // Bukan angka: hanya sama/beda yang bermakna, tanpa beda huruf besar.
  const ta = String(sel).toLowerCase();
  const tb = String(tujuan ?? '').toLowerCase();
  if (op === 'sama') return ta === tb;
  if (op === 'beda') return ta !== tb;
  return false;
}

/**
 * @param {object[]} baris
 * @param {{kolom:string, op:string, nilai?:string, bandingkan_kolom?:string}[]} saring semua syarat harus terpenuhi
 */
export function saringBaris(baris, saring = []) {
  for (const s of saring) {
    if (!NAMA_OP_SARING.includes(s?.op)) return { ok: false, error: `Operator "${s?.op}" tidak dikenal. Pilihan: ${NAMA_OP_SARING.join(', ')}.` };
    if (!s?.kolom) return { ok: false, error: 'Syarat saring butuh nama kolom.' };
  }
  const hasil = baris.filter((b) => saring.every((s) => {
    const sel = ambilKolom(b, s.kolom);
    const tujuan = s.bandingkan_kolom ? ambilKolom(b, s.bandingkan_kolom) : s.nilai;
    return bandingkan(sel, s.op, tujuan);
  }));
  return { ok: true, baris: hasil };
}

// --- mengurutkan ------------------------------------------------------------

export function urutkanBaris(baris, urut) {
  if (!urut?.kolom) return baris;
  const arah = urut.arah === 'naik' ? 1 : -1;
  const kunci = (b) => {
    const sel = ambilKolom(b, urut.kolom);
    const angka = angkaDariSel(sel);
    return { angka, teks: sel === undefined || sel === null ? '' : String(sel).toLowerCase() };
  };
  return baris
    .map((b, indeks) => ({ b, indeks, k: kunci(b) }))
    .sort((x, y) => {
      // Baris tanpa nilai selalu di bawah, apa pun arahnya.
      const kosongX = x.k.angka === null && x.k.teks === '';
      const kosongY = y.k.angka === null && y.k.teks === '';
      if (kosongX !== kosongY) return kosongX ? 1 : -1;
      let banding = 0;
      if (x.k.angka !== null && y.k.angka !== null) banding = x.k.angka < y.k.angka ? -1 : x.k.angka > y.k.angka ? 1 : 0;
      else banding = x.k.teks < y.k.teks ? -1 : x.k.teks > y.k.teks ? 1 : 0;
      return banding ? banding * arah : x.indeks - y.indeks;
    })
    .map((x) => x.b);
}

// --- agregat ----------------------------------------------------------------

export const NAMA_AGREGAT = Object.freeze(['jumlah', 'rata', 'terkecil', 'terbesar', 'banyak']);

function hitungAgregat(baris, fungsi, kolom) {
  if (fungsi === 'banyak') return { teks: String(baris.length), skala: null };
  const nilai = baris.map((b) => nilaiOperand(b, kolom)).filter((v) => v !== null);
  if (!nilai.length) return { teks: '—', skala: null };
  switch (fungsi) {
    case 'jumlah': {
      const total = nilai.reduce((s, v) => s + v, 0n);
      return { teks: tampilSkala(total), skala: total };
    }
    case 'rata': {
      const rata = bagiHalfUp(nilai.reduce((s, v) => s + v, 0n), BigInt(nilai.length));
      return { teks: tampilSkala(rata), skala: rata };
    }
    case 'terkecil': {
      const kecil = nilai.reduce((m, v) => (v < m ? v : m));
      return { teks: tampilSkala(kecil), skala: kecil };
    }
    default: {
      const besar = nilai.reduce((m, v) => (v > m ? v : m));
      return { teks: tampilSkala(besar), skala: besar };
    }
  }
}

// --- satu paket hitung ------------------------------------------------------

const KOLOM_PENGENAL = /(^|\.)(id|no|nomor|kode|code)$|Id$|Number$/;

function tampilSel(sel, kolom, turunan) {
  if (sel === undefined || sel === null || sel === '') return '—';
  if (typeof sel === 'boolean') return sel ? 'ya' : 'tidak';
  if (typeof sel === 'object') return JSON.stringify(sel).slice(0, 80);
  // Kolom pengenal (id, nomor, kode) tidak diberi pemisah ribuan. Kolom turunan
  // hasil hitung (disimpan sebagai teks angka persis) dan angka asli diformat.
  if (!KOLOM_PENGENAL.test(String(kolom))) {
    const angka = typeof sel === 'number' || turunan.has(kolom) ? keSkala(sel) : null;
    if (angka !== null) return tampilSkala(angka);
  }
  return String(sel).slice(0, 120);
}

/**
 * Menjalankan satu permintaan hitung ke daftar baris.
 *
 * @param {object[]} baris
 * @param {object} spec
 * @param {{nama:string, kolom_a:string, operasi:string, kolom_b:string}[]} [spec.turunan]
 * @param {object[]} [spec.saring]
 * @param {{kolom:string, arah?:'naik'|'turun'}} [spec.urut]
 * @param {number} [spec.ambil] jumlah baris yang ditampilkan (maks 50)
 * @param {string[]} [spec.kolom] kolom yang ditampilkan
 * @param {{fungsi:string, kolom?:string, per?:string}} [spec.agregat]
 */
export function jalankanHitung(baris, spec = {}) {
  if (!Array.isArray(baris)) return { ok: false, error: 'Daftarnya tidak ditemukan.' };
  if (baris.length > MAKS_BARIS_BACA) return { ok: false, error: `Daftarnya terlalu besar (${baris.length} baris) untuk dihitung sekaligus.` };

  const turun = tambahTurunan(baris, spec.turunan ?? []);
  if (!turun.ok) return turun;
  const saring = saringBaris(turun.baris, spec.saring ?? []);
  if (!saring.ok) return saring;
  let cocok = saring.baris;
  const jumlahCocok = cocok.length;

  const agregat = spec.agregat?.fungsi ? spec.agregat : null;
  if (agregat) {
    if (!NAMA_AGREGAT.includes(agregat.fungsi)) return { ok: false, error: `Fungsi "${agregat.fungsi}" tidak dikenal. Pilihan: ${NAMA_AGREGAT.join(', ')}.` };
    if (agregat.fungsi !== 'banyak' && !agregat.kolom) return { ok: false, error: 'Agregat butuh nama kolom.' };

    if (agregat.per) {
      const kelompok = new Map();
      for (const b of cocok) {
        const sel = ambilKolom(b, agregat.per);
        const kunci = sel === undefined || sel === null || sel === '' ? '(kosong)' : String(sel);
        if (!kelompok.has(kunci)) kelompok.set(kunci, []);
        kelompok.get(kunci).push(b);
      }
      let isi = [...kelompok.entries()].map(([kunci, anggota]) => ({ kunci, ...hitungAgregat(anggota, agregat.fungsi, agregat.kolom), banyak: anggota.length }));
      isi.sort((x, y) => {
        if (x.skala !== null && y.skala !== null) return x.skala < y.skala ? 1 : x.skala > y.skala ? -1 : 0;
        return x.kunci.localeCompare(y.kunci, 'id');
      });
      const terpotong = isi.length > MAKS_BARIS_TAMPIL;
      isi = isi.slice(0, Math.min(Number(spec.ambil) || MAKS_BARIS_TAMPIL, MAKS_BARIS_TAMPIL));
      return {
        ok: true,
        jumlahCocok,
        terpotong,
        kolom: [agregat.per, `${agregat.fungsi}${agregat.kolom ? ` ${agregat.kolom}` : ''}`, 'banyak baris'],
        isi: isi.map((g) => [g.kunci, g.teks, String(g.banyak)])
      };
    }

    const hasil = hitungAgregat(cocok, agregat.fungsi, agregat.kolom);
    return {
      ok: true,
      jumlahCocok,
      terpotong: false,
      kolom: [`${agregat.fungsi}${agregat.kolom ? ` ${agregat.kolom}` : ''}`, 'banyak baris'],
      isi: [[hasil.teks, String(jumlahCocok)]]
    };
  }

  cocok = urutkanBaris(cocok, spec.urut);
  const batas = Math.min(Math.max(Number(spec.ambil) || 20, 1), MAKS_BARIS_TAMPIL);
  const tampil = cocok.slice(0, batas);

  let kolom = Array.isArray(spec.kolom) && spec.kolom.length ? spec.kolom.slice(0, 8) : null;
  if (!kolom) {
    const turunanBaru = (spec.turunan ?? []).map((t) => t.nama);
    const dasar = Object.keys(tampil[0] ?? {}).filter((k) => {
      const nilai = tampil[0][k];
      return nilai === null || typeof nilai !== 'object';
    });
    kolom = [...new Set([...dasar.slice(0, 6), ...turunanBaru])].slice(0, 8);
  }

  return {
    ok: true,
    jumlahCocok,
    terpotong: jumlahCocok > tampil.length,
    kolom,
    isi: tampil.map((b) => kolom.map((k) => tampilSel(ambilKolom(b, k), k, new Set((spec.turunan ?? []).map((t) => t.nama)))))
  };
}

// --- peta bentuk data -------------------------------------------------------

function jenisSel(sel) {
  if (sel === null || sel === undefined) return 'kosong';
  if (typeof sel === 'number') return 'angka';
  if (typeof sel === 'boolean') return 'ya/tidak';
  if (typeof sel === 'string') return /^-?\d+(\.\d+)?$/.test(sel) ? 'angka-teks' : 'teks';
  return Array.isArray(sel) ? 'daftar' : 'objek';
}

/**
 * Menemukan semua daftar baris (array of object) di dalam hasil baca, sampai
 * kedalaman 2, dengan nama kolom dan contohnya. Dipakai untuk memberi tahu model
 * "ada daftar apa saja" tanpa mengirim seluruh isinya.
 */
export function petaDaftar(data) {
  const daftar = [];
  const telusuri = (nilai, jalur, kedalaman) => {
    if (Array.isArray(nilai)) {
      if (nilai.length && nilai.every((b) => b && typeof b === 'object' && !Array.isArray(b))) {
        const kolom = new Map();
        for (const b of nilai.slice(0, 50)) {
          for (const [k, v] of Object.entries(b)) {
            if (!kolom.has(k)) kolom.set(k, { jenis: jenisSel(v), contoh: v });
            else if (kolom.get(k).jenis === 'kosong' && v !== null && v !== undefined) kolom.set(k, { jenis: jenisSel(v), contoh: v });
          }
        }
        daftar.push({ jalur, banyak: nilai.length, kolom: [...kolom.entries()].map(([nama, info]) => ({ nama, ...info })) });
      } else if (!nilai.length) {
        daftar.push({ jalur, banyak: 0, kolom: [] });
      }
      return;
    }
    if (nilai && typeof nilai === 'object' && kedalaman < 2) {
      for (const [k, v] of Object.entries(nilai)) telusuri(v, jalur ? `${jalur}.${k}` : k, kedalaman + 1);
    }
  };
  telusuri(data, '', 0);
  return daftar;
}

/** Mengambil daftar berdasarkan jalur bertitik ("stocks" atau "report.assets"). */
export function ambilDaftar(data, jalur) {
  if (!jalur) return null;
  let sekarang = data;
  for (const bagian of String(jalur).split('.')) {
    if (sekarang === null || typeof sekarang !== 'object') return null;
    sekarang = Object.hasOwn(sekarang, bagian) ? sekarang[bagian] : undefined;
  }
  return Array.isArray(sekarang) ? sekarang : null;
}
