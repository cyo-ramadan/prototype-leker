// Perpustakaan contoh percakapan Una (Bos Cyo 2026-10-05: "contoh percakapan
// kerjaan itu disimpan di sistem informasi gitu? nanti si Una ngecek2 mana contoh
// yang cocok").
//
// Model lite jauh lebih nurut dengan CONTOH daripada aturan. Tapi menempelkan
// semua contoh ke setiap pertanyaan memboroskan token dan membuatnya bingung,
// jadi kode memilih beberapa contoh yang PALING MIRIP dengan pesan Bos (kata
// yang sama + potongan huruf yang sama), lalu hanya itu yang ikut ke prompt.
//
// Disimpan di kode (bukan tabel D1) dengan sengaja: contoh ini pengetahuan
// produk yang sama untuk semua tenant, harus lewat review + test seperti kode
// lain, dan tidak boleh memuat data tenant mana pun. Menambah contoh = menambah
// satu objek di CONTOH; test memastikan nama alatnya masih ada.
//
// Format tiap contoh:
//   pesan:   kalimat Bos, gaya chat sungguhan (boleh salah ketik)
//   langkah: urutan putaran Una, ditulis seperti yang harus dia isi

export const CONTOH = Object.freeze([
  // --- barang: lihat ---
  { pesan: 'harga es teh leci berapa?', langkah: ['cek_barang ["es teh leci"], lanjut=false'] },
  { pesan: 'hpp kopi susu sama matcha latte berapa ya', langkah: ['cek_barang ["kopi susu", "matcha latte"], lanjut=false'] },
  { pesan: 'stok gula tinggal berapa', langkah: ['stok_sisa (barang "gula"), lanjut=false'] },
  {
    pesan: 'cek harga yang anomali, terus betulin',
    langkah: [
      'cek_harga_janggal, judul "Cari harga yang janggal", lanjut=true',
      'catatan berisi 2 barang janggal, Bos belum menyebut harga baru -> selesai: "Ada 2 yang janggal: ... Harga barunya mau berapa, Bos?"'
    ]
  },
  { pesan: 'barang mana yg dijual rugi', langkah: ['cek_harga_janggal, lanjut=false'] },
  { pesan: 'ada yang harga jualnya masih 0 ga?', langkah: ['cek_harga_janggal, lanjut=false'] },

  // --- barang: ubah ---
  { pesan: 'harga es teh black curent di mandala ganti jadi 7rb', langkah: ['ubah_barang [{barang:"es teh black curent", harga_jual:"7rb"}], lanjut=false (nama gerai bukan bagian nama barang)'] },
  {
    pesan: 'harga es teh di sini berapa? kalau masih 5rb naikin jadi 6rb',
    langkah: [
      'cek_barang ["es teh"], judul "Cek harga Es Teh", lanjut=true',
      'catatan: Es Teh Manis | Rp5.000 -> ubah_barang [{barang:"Es Teh Manis", harga_jual:"6rb"}], lanjut=false',
      '(kalau catatan bilang sudah Rp6.000 -> selesai: "Es Teh Manis sudah 6.000, nggak Una ubah ya Bos.")'
    ]
  },
  {
    pesan: 'cek harga kopi susu, kalau di bawah 10rb naikin jadi 12rb, abis itu cek lagi',
    langkah: [
      'cek_barang ["kopi susu"], lanjut=true',
      'ubah_barang [{barang:"Kopi Susu", harga_jual:"12rb"}], lanjut=true (masih ada "cek lagi" sesudah "Ya")',
      'sesudah catatan "persetujuan" -> cek_barang ["Kopi Susu"], lanjut=false'
    ]
  },
  { pesan: 'Susu Kental Manis 2rb, Teh Vanilla 2rb', langkah: ['(barangnya sudah ada di catatan/percakapan) -> ubah_barang [{barang:"Susu Kental Manis", harga_jual:"2rb"}, {barang:"Teh Vanilla", harga_jual:"2rb"}]'] },
  { pesan: 'harga beli gula jadi 18rb per kilo', langkah: ['ubah_barang [{barang:"gula", harga_beli:"18rb"}]'] },
  { pesan: 'ganti nama kopi susu jadi kopi susu gula aren', langkah: ['ubah_barang [{barang:"kopi susu", nama_baru:"kopi susu gula aren"}]'] },
  { pesan: 'pindahin roti bakar ke kategori makanan', langkah: ['ubah_barang [{barang:"roti bakar", kategori:"makanan"}]'] },
  { pesan: 'matiin menu es campur, udah ga jual', langkah: ['nonaktifkan_barang "es campur"'] },

  // --- barang: buat ---
  { pesan: 'tambahin menu es kopi 15rb', langkah: ['buat_barang nama "es kopi", harga_jual "15rb" (detail lain diisi sistem, jangan ditanya)'] },
  {
    pesan: 'bikin barang namanya tutup cup manual, harganya 12rb dapet 50 pcs. jualnya sama dengan harga beli',
    langkah: ['buat_barang nama "tutup cup manual", harga_beli "12rb", isi "50", jual_sama_beli=true (harga per pcs dihitung sistem — jangan dihitung sendiri, jangan ditanya)']
  },
  {
    pesan: '5000',
    langkah: ['(Una tadi bertanya harga jual untuk TUGAS YANG SEDANG DIKERJAKAN, mis. buat_barang) -> buat_barang lagi: isian lama + harga_jual "5000"']
  },
  { pesan: 'masukin menu: es teh 5rb, kopi susu 12rb, roti bakar 15rb', langkah: ['buat_barang_banyak: SEMUA 3 barang disalin, daftar_jenis "jualan"'] },
  { pesan: 'bahan baru: gula pasir (gram), susu uht (ml), cup 16oz', langkah: ['buat_barang_banyak daftar_jenis "bahan", satuan disalin apa adanya'] },
  { pesan: 'es kopi susu itu resepnya espresso 30ml, susu 150ml, gula aren 20gr', langkah: ['buat_resep hasil "es kopi susu", komponen disalin persis (nama + qty + satuan)'] },

  // --- HPP ---
  { pesan: 'hpp bubuk matcha salah, harusnya 450 per gram mulai tanggal 28', langkah: ['hitung_ulang_hpp bahan "bubuk matcha", harga "450", dari "tanggal 28" (salin persis)'] },
  { pesan: 'koreksi hpp: gula = 17,5, kopi = 200, susu = 22', langkah: ['koreksi_hpp_banyak: SEMUA baris ke kh_daftar, urutan + angka persis'] },
  { pesan: 'hpp matcha kok aneh ya? bisa dibenerin?', langkah: ['cek_barang ["matcha"], lanjut=true', 'Bos belum menyebut harga benar -> selesai: "HPP-nya sekarang ... Harga benarnya per gram berapa, Bos?"'] },

  // --- uang (yang ini boleh bertanya detail, dengan halus) ---
  { pesan: 'catat gaji mbak rina 1,5jt', langkah: ['catat_bea_gaji karyawan "mbak rina", nominal "1,5jt"'] },
  { pesan: 'beli gas 22rb ke pak slamet bayarnya nanti', langkah: ['catat_pengeluaran keterangan "gas", nominal "22rb", pihak "pak slamet"'] },
  { pesan: 'bayar hutang ke supplier susu 500rb lewat bca', langkah: ['bayar_hutang pihak "supplier susu", nominal "500rb", cara bayar "bca"'] },

  // --- data / laporan ---
  { pesan: 'untung hari ini berapa', langkah: ['laba_periode periode "hari_ini", lanjut=false'] },
  { pesan: 'kemarin vs hari ini lebih untung mana?', langkah: ['laba_periode "kemarin", lanjut=true', 'laba_periode "hari_ini", lanjut=true', 'selesai: bandingkan, semua angka dari catatan'] },
  { pesan: 'siapa aja yang masih hutang gaji?', langkah: ['baca_api api hutang, lanjut=false'] },
  { pesan: 'menu paling laku minggu ini apa', langkah: ['baca_api api penjualan periode 7_hari_terakhir, lanjut=false'] },

  // --- akuntansi ---
  { pesan: 'una sambungin jurnal yang belum nyambung', langkah: ['samakan_aturan_jurnal'] },
  { pesan: 'sinkronkan akuntansi mandala', langkah: ['sinkron_akuntansi'] },
  { pesan: 'qris masuknya ke rekening bersama ya', langkah: ['atur_cara_bayar cb_nama "qris", cb_rekber (disalin)'] },

  // --- ngobrol / belajar ---
  { pesan: 'hpp itu apa sih', langkah: ['jelaskan topik "hpp"'] },
  { pesan: 'una bisa bantu apa aja', langkah: ['jelaskan topik "kemampuan"'] },
  { pesan: 'makasih una', langkah: ['selesai: "Sama-sama Bos!"'] },
  { pesan: 'oke sip', langkah: ['selesai: jawaban singkat ramah, tanpa angka'] },

  // --- perintah panjang berisi pekerjaan berbeda ---
  { pesan: 'bikin menu es kopi 15rb, terus koreksi hpp gula jadi 17,5, terus qris ke rekber', langkah: ['rencana: 3 langkah (buat barang / koreksi HPP / atur cara bayar), tiap perintah disalin lengkap'] }
]);

const KATA_UMUM = new Set([
  'yang', 'yg', 'ya', 'nya', 'di', 'ke', 'dari', 'ini', 'itu', 'dan', 'atau', 'jadi', 'aja', 'saja', 'dong', 'sih',
  'deh', 'kok', 'bos', 'una', 'tolong', 'mau', 'bisa', 'udah', 'sudah', 'ga', 'gak', 'nggak', 'tidak', 'apa', 'ada',
  'terus', 'lalu', 'abis', 'sama', 'buat', 'untuk', 'kalau', 'kalo', 'berapa'
]);

function kata(teks) {
  return new Set(String(teks ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((k) => k.length >= 2 && !KATA_UMUM.has(k) && !/^\d+$/.test(k)));
}

function trigram(teks) {
  const ringkas = ` ${String(teks ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()} `;
  const hasil = new Set();
  for (let i = 0; i < ringkas.length - 2; i += 1) hasil.add(ringkas.slice(i, i + 3));
  return hasil;
}

function irisan(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/** Skor kemiripan 0..1 antara pesan Bos dan satu contoh. */
export function skorContoh(pesan, contoh) {
  const kp = kata(pesan);
  const kc = kata(contoh.pesan);
  const tp = trigram(pesan);
  const tc = trigram(contoh.pesan);
  const skorKata = kp.size && kc.size ? irisan(kp, kc) / Math.min(kp.size, kc.size) : 0;
  const skorHuruf = tp.size && tc.size ? (2 * irisan(tp, tc)) / (tp.size + tc.size) : 0;
  return 0.6 * skorKata + 0.4 * skorHuruf;
}

export const JUMLAH_CONTOH = 4;
const SKOR_MINIMUM = 0.12;

/** Beberapa contoh yang paling mirip dengan pesan Bos, terbaik dulu. */
export function pilihContoh(pesan, { jumlah = JUMLAH_CONTOH, daftar = CONTOH } = {}) {
  return daftar
    .map((contoh, urutan) => ({ contoh, urutan, skor: skorContoh(pesan, contoh) }))
    .filter((x) => x.skor >= SKOR_MINIMUM)
    .sort((a, b) => b.skor - a.skor || a.urutan - b.urutan)
    .slice(0, jumlah)
    .map((x) => x.contoh);
}

/** Blok prompt "contoh yang mirip"; kosong kalau tidak ada yang cukup mirip. */
export function teksContoh(pesan, opsi) {
  const dipilih = pilihContoh(pesan, opsi);
  if (!dipilih.length) return '';
  return [
    'Contoh percakapan yang mirip dengan pesan ini (pola kerjanya, BUKAN datanya — nama dan angka tetap dari pesan Bos dan catatan kerja):',
    ...dipilih.map((c) => [`  Bos: "${c.pesan}"`, ...c.langkah.map((l, i) => `    ${c.langkah.length > 1 ? `putaran ${i + 1} -> ` : '-> '}${l}`)].join('\n'))
  ].join('\n');
}
