// Cek kesiapan gerai: bahan sapaan pertama Una (UNA-PENDAMPING.md, ketakutan #1
// "nggak tahu mulai dari mana").
//
// Bukti yang melahirkannya: semua gerai yang jalan diisi tim lewat salin
// template; gerai yang harus mulai sendiri (Galeh, M002, Gerai Contoh) berhenti
// di nol barang. Maka Una yang menyapa duluan: membaca kondisi gerai, bilang
// langkah mana yang belum, dan menawarkan kerjaannya — sekali ketuk.
//
// Dihitung KODE dari layar yang sudah ada, dengan wewenang si penyuruh (lewat
// jalur yang sama dengan alat Una lain). Tidak memanggil mesin AI, jadi tetap
// muncul walau kuncinya belum dipasang atau kuotanya habis. Dibaca saat panel
// dibuka atau gerai diganti — tidak ada polling (invariant #6).
//
// Bentuk tawaran (dirender panel):
//   {jenis:'foto_menu', label}        buka pemilih foto, dibaca sebagai daftar menu
//   {jenis:'isi', label, teks}        taruh contoh perintah di kotak ketik
//   {jenis:'kirim', label, teks}      kirim langsung sebagai pesan
//   {jenis:'jelaskan', label, topik}  penjelasan dari kamus (caca-jelaskan.js)
//   {jenis:'buka', label, layar}      buka tab layar di Workspace Gerai

import { LAYAR } from './caca-jelaskan.js';

const BACAAN = Object.freeze({
  referensi: '/api/admin/manufacturing/bootstrap',
  resep: '/api/admin/manufacturing/recipes',
  kasir: '/api/admin/cashiers',
  karyawan: '/api/admin/employees',
  laci: '/api/admin/drawers'
});

const buka = (layar) => ({ jenis: 'buka', layar, label: `Buka ${LAYAR[layar].label}` });
const CONTOH_MENU = 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb';
const CONTOH_BAHAN = 'masukin bahan: Gula pasir (gram), Teh (gram), Susu kental manis (ml)';
const CONTOH_RESEP = 'resep Es Teh: hasil 1, Teh 5, Gula pasir 20';

const BUKAN_JUALAN = new Set(['RAW_MATERIAL', 'SEMI_FINISHED']);

/**
 * Menyusun langkah dari hasil baca. Bacaan yang gagal (null) membuat langkahnya
 * "belum diketahui" — tidak pernah dianggap belum beres, supaya Una tidak
 * menyuruh mengisi sesuatu yang sebenarnya sudah ada.
 */
export function susunKesiapan({ referensi, resep, kasir, karyawan, laci }) {
  const produk = referensi ? (referensi.products ?? []) : null;
  const jualan = produk ? produk.filter((p) => !BUKAN_JUALAN.has(p.itemTypeCode)).length : null;
  const bahan = produk ? produk.filter((p) => p.itemTypeCode === 'RAW_MATERIAL').length : null;
  const jumlahResep = resep ? (resep.recipes ?? []).filter((r) => (r.status ?? 'ACTIVE') === 'ACTIVE').length : null;
  const jumlahKasir = kasir ? (kasir.cashiers ?? []).filter((k) => k.isActive !== false).length : null;
  const jumlahKaryawan = karyawan ? (karyawan.employees ?? []).filter((e) => e.status === 'ACTIVE' && e.ownedByThisStore).length : null;
  const jumlahLaci = laci ? (laci.drawers ?? []).length : null;
  const store = referensi?.store ?? null;
  const adaTitik = store ? store.attendanceRefLatitude != null && store.attendanceRefLongitude != null : null;

  const langkah = [
    {
      id: 'menu',
      wajib: true,
      judul: 'Daftar menu jualan',
      selesai: jualan === null ? null : jualan > 0,
      keterangan: jualan ? `${jualan} barang jualan` : 'Belum ada barang yang bisa dijual di kasir.',
      tawaran: [
        { jenis: 'foto_menu', label: '📷 Foto daftar menu' },
        { jenis: 'isi', label: '✍️ Ketik daftar menu', teks: CONTOH_MENU }
      ]
    },
    {
      id: 'kasir',
      wajib: true,
      judul: 'Akun kasir',
      selesai: jumlahKasir === null ? null : jumlahKasir > 0,
      keterangan: jumlahKasir ? `${jumlahKasir} akun kasir` : 'Belum ada yang bisa login di Kasir.',
      tawaran: [buka('cashiers'), { jenis: 'jelaskan', topik: 'akun_kasir', label: 'Kenapa bukan lewat Una?' }]
    },
    {
      id: 'jualan_pertama',
      wajib: true,
      judul: 'Jualan pertama',
      selesai: jumlahLaci === null ? null : jumlahLaci > 0,
      keterangan: jumlahLaci ? 'Kasir sudah pernah membuka laci.' : 'Kasir membuka laci lalu menjual dari halaman Kasir.',
      tawaran: [{ jenis: 'jelaskan', topik: 'jualan_pertama', label: 'Caranya gimana?' }]
    },
    {
      id: 'resep',
      wajib: false,
      // Dipakai panel untuk menawarkan "masukin bahan dulu" atau langsung resep.
      jumlah: { bahan, resep: jumlahResep },
      judul: 'Bahan & resep',
      selesai: jumlahResep === null ? null : jumlahResep > 0,
      keterangan: jumlahResep
        ? `${jumlahResep} resep`
        : bahan
          ? `${bahan} bahan, belum ada resep — HPP menu belum terhitung dari bahan.`
          : 'Belum ada bahan dan resep — untung-rugi belum memperhitungkan modal bahan.',
      tawaran: bahan
        ? [{ jenis: 'isi', label: '✍️ Bikin resep', teks: CONTOH_RESEP }, { jenis: 'jelaskan', topik: 'resep', label: 'Apa itu resep?' }]
        : [{ jenis: 'isi', label: '✍️ Masukin bahan', teks: CONTOH_BAHAN }, { jenis: 'jelaskan', topik: 'resep', label: 'Perlu nggak sih?' }]
    },
    {
      id: 'karyawan',
      wajib: false,
      judul: 'Data karyawan',
      selesai: jumlahKaryawan === null ? null : jumlahKaryawan > 0,
      keterangan: jumlahKaryawan ? `${jumlahKaryawan} karyawan` : 'Untuk presensi foto + GPS dan gaji otomatis.',
      tawaran: [buka('employees')]
    },
    {
      id: 'lokasi',
      wajib: false,
      judul: 'Titik lokasi presensi',
      selesai: adaTitik,
      keterangan: adaTitik ? 'Sudah diisi.' : 'Supaya absen di luar gerai ketahuan.',
      tawaran: [buka('store'), { jenis: 'jelaskan', topik: 'presensi', label: 'Gunanya apa?' }]
    }
  ];

  const diketahui = langkah.filter((l) => l.selesai !== null);
  const wajib = langkah.filter((l) => l.wajib);
  const siapJualan = wajib.every((l) => l.selesai !== false);
  // Langkah berikutnya: wajib yang belum dulu, baru anjuran. Jualan pertama
  // baru ditawarkan setelah menu dan kasir ada — tanpa itu belum bisa.
  const menuDanKasir = langkah[0].selesai !== false && langkah[1].selesai !== false;
  const berikutnya = langkah.find((l) => l.wajib && l.selesai === false && (l.id !== 'jualan_pertama' || menuDanKasir))
    ?? langkah.find((l) => !l.wajib && l.selesai === false)
    ?? null;

  return {
    langkah: langkah.map(({ tawaran, ...l }) => ({ ...l, tawaran: l.selesai === false ? tawaran : [] })),
    beres: diketahui.filter((l) => l.selesai).length,
    total: langkah.length,
    siapJualan,
    gerai: store ? { code: store.code, storeName: store.storeName } : null,
    berikutnya: berikutnya?.id ?? null
  };
}

/** Membaca kelima layar lewat jalur Una, lalu menyusun kesiapannya. */
export async function periksaKesiapan(jalur) {
  const kunci = Object.keys(BACAAN);
  const hasil = await Promise.all(kunci.map((k) => jalur.baca(BACAAN[k]).catch(() => ({ ok: false }))));
  const data = Object.fromEntries(kunci.map((k, i) => [k, hasil[i]?.ok ? hasil[i].data : null]));
  return susunKesiapan(data);
}

/** Kalimat sapaan dari kesiapan — disusun kode, dibumbui di batas API. */
export function sapaanKesiapan(kesiapan, namaGerai) {
  const nama = kesiapan.gerai?.storeName || namaGerai || 'gerai ini';
  if (kesiapan.siapJualan && !kesiapan.berikutnya) {
    return `${nama} sudah siap semua. Mau Una bantu apa hari ini?`;
  }
  if (kesiapan.siapJualan) {
    return `${nama} sudah bisa jualan. Biar makin lengkap, tinggal ${kesiapan.total - kesiapan.beres} langkah lagi — santai, Una bantuin.`;
  }
  const langkahPertama = kesiapan.langkah.find((l) => l.id === kesiapan.berikutnya);
  const pembuka = kesiapan.beres === 0
    ? `${nama} masih kosong, jadi kita mulai dari nol bareng ya.`
    : `${nama} baru ${kesiapan.beres} dari ${kesiapan.total} langkah beres.`;
  if (langkahPertama?.id === 'menu') {
    return `${pembuka} Yang paling cepat: kirim foto papan menu atau ketik daftar menunya kayak nulis di chat — Una yang masukin semuanya, Bos tinggal cek lalu tekan "Ya".`;
  }
  if (langkahPertama?.id === 'kasir') {
    return `${pembuka} Berikutnya akun kasir. Yang ini dibuat di layarnya sendiri karena ada PIN — Una bukakan layarnya.`;
  }
  if (langkahPertama?.id === 'jualan_pertama') {
    return `${pembuka} Menu dan kasir sudah ada — tinggal jualan pertama di halaman Kasir.`;
  }
  return pembuka;
}
