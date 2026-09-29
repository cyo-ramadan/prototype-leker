// Pembacaan lembar rekap harian oleh Caca (ADR-044 Tahap 1, jalur web).
//
// Pembagian tugas yang disengaja: MODEL hanya menyalin apa yang tertulis di
// lembar, KODE yang menghitung dan membandingkan. Model yang boleh menghitung
// akan menyajikan total yang terdengar meyakinkan padahal salah, dan itu jenis
// kesalahan yang paling sulit ketahuan.
//
// Modul ini tidak menulis apa pun. Hasilnya usulan yang masih harus
// dikonfirmasi manusia — belum transaksi.

// Skema netral — bukan bentuk milik penyedia mana pun. Penerjemahan ke bentuk
// yang dimengerti penyedia dilakukan di caca-ai-client.js.
export const REKAP_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['tanggal_tertulis', 'cabang_tertulis', 'penjualan', 'pengeluaran', 'pengurang_setoran', 'ringkasan_tertulis'],
  properties: {
    tanggal_tertulis: { type: 'string', description: 'Tanggal persis seperti tertulis, mis. "06-Sep-26". Kosongkan jika tidak ada.' },
    cabang_tertulis: { type: 'string', description: 'Nama cabang seperti tertulis. Hanya catatan; tidak menentukan gerai mana pun.' },
    shift_tertulis: { type: 'string' },
    penjualan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nama_tertulis', 'jumlah_terjual', 'harga_satuan', 'jumlah'],
        properties: {
          nama_tertulis: { type: 'string' },
          stok_awal: { type: 'string' },
          stok_sisa: { type: 'string' },
          jumlah_terjual: { type: 'string' },
          harga_satuan: { type: 'string' },
          jumlah: { type: 'string' }
        }
      }
    },
    pengeluaran: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nama_tertulis', 'jumlah'],
        properties: {
          nama_tertulis: { type: 'string' },
          banyaknya: { type: 'string' },
          jumlah: { type: 'string' }
        }
      }
    },
    pengurang_setoran: {
      type: 'array',
      description: 'Kolom yang mengurangi setoran tapi bukan belanja, mis. Qris, Gofood.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nama_tertulis', 'jumlah'],
        properties: {
          nama_tertulis: { type: 'string' },
          jumlah: { type: 'string' }
        }
      }
    },
    ringkasan_tertulis: {
      type: 'object',
      additionalProperties: false,
      required: ['total_penjualan', 'total_pengeluaran', 'setoran'],
      properties: {
        total_penjualan: { type: 'string' },
        total_pengeluaran: { type: 'string' },
        total_pengurang_setoran: { type: 'string' },
        setoran: { type: 'string' },
        total_item_terjual: { type: 'string' }
      }
    }
  }
});

export const REKAP_SYSTEM_PROMPT = [
  'Kamu Caca, asisten toko. Tugasmu sekarang cuma satu: menyalin isi lembar rekap harian apa adanya.',
  '',
  'Aturan keras:',
  '- Salin angka PERSIS seperti tertulis, sebagai teks. "7.000" ditulis "7.000", bukan 7000 dan bukan 7.',
  '- Sel kosong atau berisi "-" ditulis sebagai string kosong. Jangan diisi, jangan ditebak.',
  '- Jangan menghitung apa pun. Jangan membetulkan angka yang kelihatan salah.',
  '- Angka negatif disalin apa adanya, termasuk stok minus.',
  '- Baris yang seluruhnya kosong dilewati.',
  '- Bahan atau kemasan yang bukan barang jualan (mis. cup, gula, susu curah) masuk ke pengeluaran',
  '  hanya kalau memang ada di kolom pengeluaran; jangan dipindah sendiri.',
  '',
  'Kalau ada yang janggal, tetap salin apa adanya. Yang menilai kejanggalan bukan kamu.'
].join('\n');

const HANYA_ANGKA = /^-?\d+$/;

/**
 * Mengurai angka bergaya Indonesia: titik adalah pemisah ribuan, bukan desimal.
 * Dikembalikan sebagai integer rupiah — tidak pernah float, supaya tidak ada
 * pembulatan diam-diam sebelum angkanya sempat dikonfirmasi orang.
 */
export function uraikanAngka(teks) {
  const mentah = String(teks ?? '').trim();
  if (!mentah || mentah === '-' || mentah === '—') return { ada: false, nilai: null };

  const bersih = mentah.replace(/\s|rp/gi, '');
  if (bersih.includes(',')) {
    return { ada: true, nilai: null, janggal: `"${mentah}" mengandung koma desimal` };
  }

  const negatif = bersih.startsWith('-');
  const angka = negatif ? bersih.slice(1) : bersih;
  const bagian = angka.split('.');

  if (bagian.length > 1) {
    const ribuanRapi = bagian.slice(1).every((b) => b.length === 3) && bagian[0].length > 0 && bagian[0].length <= 3;
    if (!ribuanRapi) {
      return { ada: true, nilai: null, janggal: `"${mentah}" bukan format ribuan yang lazim` };
    }
  }

  const gabung = bagian.join('');
  if (!HANYA_ANGKA.test(gabung)) {
    return { ada: true, nilai: null, janggal: `"${mentah}" tidak terbaca sebagai angka` };
  }

  return { ada: true, nilai: negatif ? -Number(gabung) : Number(gabung) };
}

function normalkanNama(nama) {
  return String(nama ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Mencocokkan nama di lembar ke master barang milik gerai itu sendiri.
 * Sengaja hanya cocok persis (setelah normalisasi) — tebakan mirip-mirip akan
 * memasangkan barang yang salah tanpa ada yang sadar. Tidak ketemu = tidak
 * ketemu, biar orangnya yang menentukan.
 */
export function cocokkanBarang(namaTertulis, daftarBarang) {
  const kunci = normalkanNama(namaTertulis);
  if (!kunci) return null;
  const kandidat = daftarBarang.filter((barang) => normalkanNama(barang.name) === kunci);
  return kandidat.length === 1 ? kandidat[0] : null;
}

function catat(daftar, jenis, pesan) {
  daftar.push({ jenis, pesan });
}

function bacaSel(nilaiTeks, label, perluKonfirmasi) {
  const hasil = uraikanAngka(nilaiTeks);
  if (hasil.janggal) catat(perluKonfirmasi, 'ANGKA_TIDAK_TERBACA', `${label}: ${hasil.janggal}`);
  return hasil.nilai;
}

function periksaBarisPenjualan(baris, daftarBarang, perluKonfirmasi) {
  const label = baris.nama_tertulis || '(tanpa nama)';
  const qty = bacaSel(baris.jumlah_terjual, `Jumlah terjual ${label}`, perluKonfirmasi);
  const harga = bacaSel(baris.harga_satuan, `Harga ${label}`, perluKonfirmasi);
  const jumlahTertulis = bacaSel(baris.jumlah, `Jumlah ${label}`, perluKonfirmasi);
  const stokAwal = bacaSel(baris.stok_awal, `Stok awal ${label}`, perluKonfirmasi);
  const stokSisa = bacaSel(baris.stok_sisa, `Stok sisa ${label}`, perluKonfirmasi);

  const barang = cocokkanBarang(baris.nama_tertulis, daftarBarang);
  if (!barang) {
    catat(perluKonfirmasi, 'BARANG_BELUM_COCOK', `"${label}" belum cocok dengan barang mana pun di gerai ini.`);
  }

  const jumlahHitung = qty !== null && harga !== null ? qty * harga : null;
  if (jumlahHitung !== null && jumlahTertulis !== null && jumlahHitung !== jumlahTertulis) {
    catat(
      perluKonfirmasi,
      'JUMLAH_TIDAK_COCOK',
      `${label}: ${qty} x ${harga} = ${jumlahHitung}, tapi di lembar tertulis ${jumlahTertulis}.`
    );
  }

  if (stokSisa !== null && stokSisa < 0) {
    catat(perluKonfirmasi, 'STOK_MINUS', `${label}: stok sisa ${stokSisa}. Dibiarkan apa adanya, perlu dicek.`);
  }

  if (stokAwal !== null && stokSisa !== null && qty !== null) {
    const selisih = stokAwal - stokSisa;
    if (selisih !== qty) {
      catat(
        perluKonfirmasi,
        'SELISIH_STOK',
        `${label}: stok turun ${selisih} tapi yang tercatat terjual ${qty}.`
      );
    }
  }

  return {
    nama_tertulis: baris.nama_tertulis ?? '',
    product_id: barang?.id ?? null,
    product_name: barang?.name ?? null,
    qty,
    harga_satuan: harga,
    jumlah_tertulis: jumlahTertulis,
    jumlah_hitung: jumlahHitung,
    stok_awal: stokAwal,
    stok_sisa: stokSisa
  };
}

function jumlahkan(nilai) {
  return nilai.reduce((total, angka) => total + (angka ?? 0), 0);
}

function bandingkanTotal(namaTotal, hitung, tertulis, perluKonfirmasi) {
  if (tertulis === null || hitung === tertulis) return;
  catat(
    perluKonfirmasi,
    'TOTAL_TIDAK_COCOK',
    `${namaTotal}: rincian berjumlah ${hitung}, tapi di lembar tertulis ${tertulis}.`
  );
}

/**
 * @param {object} bacaan hasil mentah dari model (sudah tervalidasi skema alat)
 * @param {{ id:number, name:string }[]} daftarBarang master barang milik gerai dari sesi login
 */
export function periksaRekap(bacaan, daftarBarang = []) {
  const perluKonfirmasi = [];

  const penjualan = (bacaan?.penjualan ?? [])
    .filter((baris) => String(baris?.nama_tertulis ?? '').trim())
    .map((baris) => periksaBarisPenjualan(baris, daftarBarang, perluKonfirmasi));

  const pengeluaran = (bacaan?.pengeluaran ?? [])
    .filter((baris) => String(baris?.nama_tertulis ?? '').trim())
    .map((baris) => ({
      nama_tertulis: baris.nama_tertulis,
      banyaknya: bacaSel(baris.banyaknya, `Banyaknya ${baris.nama_tertulis}`, perluKonfirmasi),
      jumlah: bacaSel(baris.jumlah, `Pengeluaran ${baris.nama_tertulis}`, perluKonfirmasi)
    }));

  const pengurangSetoran = (bacaan?.pengurang_setoran ?? [])
    .filter((baris) => String(baris?.nama_tertulis ?? '').trim())
    .map((baris) => ({
      nama_tertulis: baris.nama_tertulis,
      jumlah: bacaSel(baris.jumlah, `Pengurang setoran ${baris.nama_tertulis}`, perluKonfirmasi)
    }));

  const ringkasanTertulis = bacaan?.ringkasan_tertulis ?? {};
  const totalPenjualanTertulis = bacaSel(ringkasanTertulis.total_penjualan, 'Total penjualan', perluKonfirmasi);
  const totalPengeluaranTertulis = bacaSel(ringkasanTertulis.total_pengeluaran, 'Total pengeluaran', perluKonfirmasi);
  const setoranTertulis = bacaSel(ringkasanTertulis.setoran, 'Setoran', perluKonfirmasi);

  const totalPenjualan = jumlahkan(penjualan.map((baris) => baris.jumlah_hitung ?? baris.jumlah_tertulis));
  const totalPengeluaran = jumlahkan(pengeluaran.map((baris) => baris.jumlah));
  const totalPengurangSetoran = jumlahkan(pengurangSetoran.map((baris) => baris.jumlah));
  const setoran = totalPenjualan - totalPengeluaran - totalPengurangSetoran;

  bandingkanTotal('Total penjualan', totalPenjualan, totalPenjualanTertulis, perluKonfirmasi);
  bandingkanTotal('Total pengeluaran', totalPengeluaran, totalPengeluaranTertulis, perluKonfirmasi);
  bandingkanTotal('Setoran', setoran, setoranTertulis, perluKonfirmasi);

  for (const baris of pengurangSetoran) {
    catat(
      perluKonfirmasi,
      'ARTI_PENGURANG_SETORAN',
      `"${baris.nama_tertulis}" mengurangi setoran. Ini penjualan yang dibayar non-tunai, atau memang uang keluar?`
    );
  }

  if (String(bacaan?.cabang_tertulis ?? '').trim()) {
    catat(
      perluKonfirmasi,
      'CABANG_DARI_LEMBAR',
      `Di lembar tertulis cabang "${bacaan.cabang_tertulis}". Yang dipakai tetap gerai dari sesi login, bukan tulisan ini.`
    );
  }

  return {
    tanggal_tertulis: bacaan?.tanggal_tertulis ?? '',
    cabang_tertulis: bacaan?.cabang_tertulis ?? '',
    shift_tertulis: bacaan?.shift_tertulis ?? '',
    penjualan,
    pengeluaran,
    pengurang_setoran: pengurangSetoran,
    ringkasan: {
      total_penjualan: totalPenjualan,
      total_penjualan_tertulis: totalPenjualanTertulis,
      total_pengeluaran: totalPengeluaran,
      total_pengeluaran_tertulis: totalPengeluaranTertulis,
      total_pengurang_setoran: totalPengurangSetoran,
      setoran,
      setoran_tertulis: setoranTertulis
    },
    perlu_konfirmasi: perluKonfirmasi
  };
}
