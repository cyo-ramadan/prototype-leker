// Kamus istilah + peta aplikasi untuk pemilik yang baru mulai (UNA-PENDAMPING.md,
// ketakutan #4 "istilahnya nggak ngerti" dan #6 "nggak tahu harus pencet apa").
//
// Sengaja TIDAK disusun model. Penjelasan "HPP itu apa" yang dikarang mesin AI
// bisa terdengar meyakinkan tapi salah untuk aplikasi ini (mis. HPP kita
// rata-rata bergerak, bukan FIFO), dan pemilik baru tidak punya cara
// mengetahuinya. Isinya ditulis tangan, dicocokkan kode, dan tetap jalan
// walau mesin AI belum tersambung.
//
// Tiap entri boleh membawa tawaran sekali ketuk (lihat caca-kesiapan.js untuk
// bentuknya): membuka layarnya, atau mengisi contoh perintah ke kotak ketik.

import { normalkan } from './caca-aksi-dasar.js';
import { kataInti } from './caca-kata.js';
import { cariMenu, jawabanMenu } from './caca-peta.js';

/** Layar yang bisa dibukakan Una. `gerai` = tab di Workspace Gerai. */
export const LAYAR = Object.freeze({
  products: { label: 'Data Barang', halaman: 'gerai' },
  manufacturing: { label: 'Resep & Satuan', halaman: 'gerai' },
  cashiers: { label: 'Akun Kasir', halaman: 'gerai' },
  employees: { label: 'Karyawan', halaman: 'gerai' },
  store: { label: 'Profil Toko', halaman: 'gerai' },
  approvals: { label: 'Persetujuan', halaman: 'gerai' },
  drawers: { label: 'Laci Kasir', halaman: 'gerai' },
  stock: { label: 'Stok', halaman: 'gerai' },
  labarugi: { label: 'Untung Rugi', halaman: 'gerai' },
  hutangpiutang: { label: 'Hutang & Pembayaran', halaman: 'gerai' },
  beaops: { label: 'Biaya Operasional', halaman: 'gerai' },
  sharedaccounts: { label: 'Rekening Bersama', halaman: 'gerai' },
  accountingWorkspaceTab: { label: 'Pembukuan', halaman: 'gerai' },
  'attendance-report': { label: 'Laporan Presensi', halaman: 'gerai' },
  'setoran-cs': { label: 'Setoran CS', halaman: 'gerai' },
  'permit-report': { label: 'Izin & Koreksi', halaman: 'gerai' },
  suppliers: { label: 'Supplier', halaman: 'gerai' },
  categories: { label: 'Kategori', halaman: 'gerai' }
});

const buka = (layar) => ({ jenis: 'buka', layar, label: `Buka layar ${LAYAR[layar].label}` });
const isi = (label, teks) => ({ jenis: 'isi', label, teks });
const jelas = (topik, label) => ({ jenis: 'jelaskan', topik, label });

export const KAMUS = Object.freeze([
  {
    id: 'kemampuan',
    judul: 'Una bisa bantu apa aja',
    kunci: ['una bisa apa', 'bisa apa aja', 'bisa bantu apa', 'kemampuan', 'fitur una', 'apa yang bisa', 'help', 'bantuan'],
    isi: [
      'Una bisa mengerjakan bagian yang biasanya bikin malas:',
      '• Ngisi data: banyak barang sekaligus (ketik daftarnya atau foto papan menu), bahan, resep.',
      '• Ngubah data: harga jual/beli, nama, dan kategori barang; koreksi HPP bahan yang salah catat.',
      '• Nyatet: biaya (gaji, sewa lapak, lain-lain), bayar hutang, uang muka ke supplier, jurnal.',
      '• Nanya apa aja: untung hari ini, stok tinggal berapa, barang yang HPP-nya kemahalan, dst.',
      '• Baca foto lembar rekap harian, jelasin istilah, dan batalin barang yang salah bikin.',
      'Semua yang menyimpan data lewat kartu draft dulu — belum ada yang tersimpan sebelum Bos tekan "Ya".',
      '• Urusan karyawan: tambah karyawan + akun login (password dibuat sistem, tidak lewat mesin AI), ubah jadwal, potongan/bonus gaji.',
      'Yang tetap di kasir: penjualan, pembelian, dan uang laci.'
    ].join('\n'),
    tawaran: [
      isi('Masukin daftar menu', 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb'),
      { jenis: 'kirim', label: 'Untung hari ini?', teks: 'untung hari ini berapa?' },
      jelas('mulai', 'Mulai dari mana?')
    ],
    tanpaAksi: 'daftar kemampuan, bukan satu pekerjaan'
  },
  {
    id: 'mulai',
    judul: 'Mulai dari mana',
    kunci: ['mulai dari mana', 'cara mulai', 'langkah awal', 'baru pertama', 'pertama kali', 'cara pakai', 'gimana makenya', 'bingung'],
    isi: [
      'Urutan paling cepat sampai bisa jualan:',
      '1. Daftar menu — kirim foto papan menu atau ketik daftarnya, Una yang masukin.',
      '2. Akun kasir — bilang ke Una "buatin akun kasir Rika username rika", atau buat di layar Akun Kasir. Password dibuat sistem.',
      '3. Kasir membuka laci di HP/komputer kasir, lalu jualan pertama.',
      'Bahan & resep, karyawan, dan titik lokasi presensi bisa menyusul — dan Una ingatkan.'
    ].join('\n'),
    tawaran: [
      { jenis: 'foto_menu', label: '📷 Foto daftar menu' },
      isi('✍️ Ketik daftar menu', 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb'),
      buka('cashiers')
    ],
    tanpaAksi: 'urutan langkah; tiap langkah punya alat/tawarannya sendiri'
  },
  {
    id: 'hpp',
    judul: 'HPP (harga pokok)',
    kunci: ['hpp', 'harga pokok', 'modal barang', 'harga modal', 'average cost', 'rata rata'],
    isi: [
      'HPP = modal untuk satu barang yang terjual. Untung kotor = harga jual − HPP.',
      'Di sini HPP dihitung otomatis dengan rata-rata: tiap pembelian bahan atau produksi memperbarui modal rata-ratanya.',
      'Untuk menu yang dibuat dari bahan, HPP datang dari resep (takaran bahan × harga bahannya).',
      'Kalau HPP kelihatan aneh, biasanya harga beli bahan salah ketik — betulkan lewat Hitung Ulang HPP.'
    ].join('\n'),
    tawaran: [jelas('resep', 'Apa itu resep?'), { jenis: 'kirim', label: 'Barang yang HPP-nya di atas harga jual', teks: 'barang mana yang HPP-nya di atas harga jual?' }],
    tanpaAksi: 'penjelasan istilah; koreksi HPP lewat hitung_ulang_hpp saat Bos menyebut bahannya'
  },
  {
    id: 'resep',
    judul: 'Resep & produksi',
    kunci: ['resep', 'takaran', 'produksi', 'bom', 'dadakan', 'komposisi'],
    isi: [
      'Resep = takaran bahan untuk membuat satu kali hasil, mis. 1 Es Teh butuh teh 5 gram + gula 20 gram.',
      'Dari resep, stok bahan berkurang otomatis dan HPP menu terhitung sendiri.',
      'Bahannya harus sudah ada di daftar barang (sebagai bahan, dengan satuan gram/ml/pcs).',
      'Satu menu boleh punya dua resep (mis. manis dan tawar); kasir bisa memilih saat jualan.'
    ].join('\n'),
    tawaran: [
      isi('Masukin bahan dulu', 'masukin bahan: Gula pasir (gram), Teh (gram), Susu kental manis (ml)'),
      isi('Bikin resep', 'resep Es Teh: hasil 1, Teh 5, Gula pasir 20'),
      buka('manufacturing')
    ],
    aksi: { alat: 'buat_resep', tawar: 'Mau Una buatkan resepnya? Bilang "buatin", atau langsung tulis mis. "resep Es Teh: hasil 1, Teh 5, Gula pasir 20".', tombol: 'Una buatkan resep' }
  },
  {
    id: 'jenis_tipe',
    judul: 'Tipe barang dan Jenis barang',
    kunci: ['tipe barang', 'jenis barang', 'barang jadi', 'bahan baku', 'setengah jadi', 'item type', 'product kind'],
    isi: [
      'Tipe barang = perannya: Barang Jadi (dijual di kasir), Bahan (dibeli, dipakai resep), Setengah Jadi.',
      'Jenis barang = pengelompokan untuk pembukuan: menentukan akun Persediaan dan HPP-nya. Barang baru otomatis dapat jenis yang benar.',
      'Jadi pemilik cukup memikirkan tipe; jenis urusan pembukuan.'
    ].join('\n'),
    tawaran: [buka('products')],
    aksi: { alat: 'betulkan_klasifikasi_barang', tawar: 'Mau Una betulkan tipe/jenis barang yang keliru? Bilang "betulin", atau sebut barangnya mis. \'Tipe "bahan baku": Gula, Teh\'.', tombol: 'Una betulkan' }
  },
  {
    id: 'master_barang',
    judul: 'Master barang: gerai atau entity?',
    kunci: ['master barang', 'data barang', 'kode barang', 'master entity', 'barang entity', 'harga di master'],
    isi: [
      'Harga jual, harga beli, nama, dan kategori barang disimpan di Data Barang TIAP GERAI — jadi harga Es Teh di Mandala bisa beda dengan di Dermo.',
      'Entity cuma menyimpan Kode Barang dan foto, supaya barang yang sama bisa dipakai banyak gerai tanpa diketik ulang.',
      'Kalau Bos minta Una ubah harga, yang diubah Data Barang gerai yang dipilih di judul chat Una (tombol ▾), bukan gerai yang sedang terbuka di workspace.'
    ].join('\n'),
    tawaran: [buka('products')],
    aksi: { alat: 'buat_barang', tawar: 'Mau Una tambahkan barangnya? Bilang "buatin", atau langsung mis. "bikin barang Es Teh harga 5rb".', tombol: 'Una tambahkan barang' }
  },
  {
    id: 'satuan',
    judul: 'Satuan barang',
    kunci: ['satuan', 'unit', 'gram', 'pcs', 'mililiter', 'satuan dasar'],
    isi: [
      'Satuan dasar = satuan terkecil yang dipakai menghitung stok dan resep (gram, ml, pcs).',
      'Bahan sebaiknya pakai gram/ml supaya takaran resep tepat; menu jualan biasanya pcs.',
      'Tersedia: pcs, gram, kilogram, mililiter, liter.'
    ].join('\n'),
    tawaran: [buka('manufacturing')],
    tanpaAksi: 'penjelasan istilah; satuan dipilih saat membuat barang/bahan'
  },
  {
    id: 'stok_minus',
    judul: 'Stok minus',
    kunci: ['stok minus', 'minus', 'stok negatif', 'negatif', 'stok tidak sesuai penjualan', 'tidak sesuai dengan transaksi'],
    isi: [
      'Stok minus bukan error: artinya barangnya sudah terjual sebelum pembeliannya dicatat.',
      'Begitu pembelian dicatat di kasir, stoknya kembali sesuai. Angkanya sengaja tidak disembunyikan supaya ketahuan ada pembelian yang belum dicatat.',
      'Cara menanganinya: (1) Barang → Stok → Lihat Mutasi untuk melihat penjualan/pemakaian yang mengurangi; (2) pastikan semua belanja sudah dicatat lewat Beli Bahan; (3) untuk bahan, cek takaran resepnya; (4) kalau tetap beda dengan hitungan fisik, ajukan Penyesuaian Stok dari kasir.'
    ].join('\n'),
    tawaran: [buka('stock'), jelas('penyesuaian_stok', 'Cara Penyesuaian Stok')],
    tanpaAksi: 'penjelasan; stok kembali sesuai saat kasir mencatat pembelian (Una tidak mencatat pembelian)'
  },
  {
    id: 'untung_rugi',
    judul: 'Untung rugi',
    kunci: ['untung rugi', 'laba rugi', 'laba', 'untung', 'net profit', 'rugi', 'omzet', 'omset'],
    isi: [
      'Omzet = total penjualan. Untung kotor = omzet − HPP. Untung bersih = untung kotor − beban (gaji, sewa lapak, dll).',
      'Semuanya terhitung sendiri dari penjualan, pembelian, dan biaya yang dicatat — tidak perlu rekap manual.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Untung hari ini?', teks: 'untung hari ini berapa?' }, buka('labarugi')],
    tanpaAksi: 'angkanya ditanyakan langsung ("untung hari ini berapa?") — alat bacanya bukan alat tulis'
  },
  {
    id: 'jurnal',
    judul: 'Jurnal',
    kunci: ['jurnal', 'debit', 'kredit', 'posting', 'pembukuan', 'akuntansi'],
    isi: [
      'Jurnal = catatan pembukuan. Hampir semuanya dibuat OTOMATIS dari penjualan, pembelian, dan biaya — pemilik tidak perlu menulisnya.',
      'Jurnal manual cuma untuk hal di luar itu (mis. setoran modal). Debit dan kredit wajib sama persis.',
      'Jurnal yang sudah diposting tidak bisa diedit; kalau salah, dibetulkan dengan jurnal balik — jadi jejaknya rapi.'
    ].join('\n'),
    tawaran: [isi('Contoh jurnal setoran modal', 'jurnal setoran modal 5jt: debit Bank, kredit Modal Pemilik'), buka('accountingWorkspaceTab')],
    aksi: { alat: 'buat_jurnal', tawar: 'Mau Una buatkan jurnalnya? Sebut isinya, mis. "jurnal setoran modal 5jt: debit Bank, kredit Modal Pemilik".', tombol: 'Una buatkan jurnal' }
  },
  {
    id: 'akun',
    judul: 'Akun (bagan akun)',
    kunci: ['akun', 'coa', 'bagan akun', 'chart of account', 'kode akun'],
    isi: [
      'Akun = "laci" pembukuan tempat uang dan nilai dicatat: Kas, Bank, Persediaan, Penjualan, HPP, Beban, Modal, dst.',
      'Bagan akun standar sudah disiapkan sama di semua gerai, jadi pemilik tidak perlu membuatnya.'
    ].join('\n'),
    tawaran: [buka('accountingWorkspaceTab')],
    tanpaAksi: 'penjelasan istilah; bagan akun sudah disiapkan'
  },
  {
    id: 'rekening_bersama',
    judul: 'Rekening Bersama',
    kunci: ['rekening bersama', 'rekber', 'shared account', 'rekening'],
    isi: [
      'Rekening Bersama = satu rekening bank yang dipakai beberapa gerai sekaligus.',
      'Tiap gerai tetap punya bagian saldonya sendiri, jadi uang gerai A tidak tercampur dengan gerai B di laporan.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Cek Rekening Bersama', teks: 'cek rekening bersama' }, buka('sharedaccounts')],
    aksi: { alat: 'cek_rekening_bersama', tawar: 'Mau Una cekkan saldonya sekarang?', tombol: 'Una cekkan' }
  },
  {
    id: 'deposit',
    judul: 'Deposit / uang muka',
    kunci: ['deposit', 'uang muka', 'dp', 'titip uang', 'panjar'],
    isi: [
      'Uang muka = uang yang dibayar duluan ke supplier sebelum barangnya datang.',
      'Saldonya disimpan sebagai Deposit, lalu pembelian berikutnya bisa dibayar dari situ.'
    ].join('\n'),
    tawaran: [isi('Catat uang muka', 'uang muka ke Pak Slamet 500rb lewat transfer bank'), buka('hutangpiutang')],
    aksi: { alat: 'buat_uang_muka', tawar: 'Mau Una catatkan uang mukanya? Sebut ke siapa, berapa, dan lewat apa, mis. "uang muka ke Pak Slamet 500rb lewat transfer bank".', tombol: 'Una catatkan' }
  },
  {
    id: 'bea',
    judul: 'Bea / biaya operasional',
    kunci: ['bea', 'biaya operasional', 'bea gaji', 'bea lapak', 'sewa lapak', 'pengeluaran', 'beban'],
    isi: [
      'Bea = biaya menjalankan gerai: Bea Gaji, Bea Lapak (sewa tempat), dan Bea Lainnya (gas, sampah, dll).',
      'Boleh dicatat walau belum dibayar — jadi hutang dulu, dilunasi belakangan.'
    ].join('\n'),
    tawaran: [isi('Catat biaya', 'beli gas 22rb ke Pak Slamet, bayarnya nanti'), buka('beaops')],
    aksi: { alat: 'catat_pengeluaran', tawar: 'Mau Una catatkan biayanya? Sebut untuk apa, berapa, ke siapa, mis. "beli gas 22rb ke Pak Slamet".', tombol: 'Una catatkan' }
  },
  {
    id: 'hutang',
    judul: 'Hutang & piutang',
    kunci: ['hutang', 'utang', 'piutang', 'kasbon', 'tagihan'],
    isi: [
      'Hutang = yang belum gerai bayar (gaji, sewa, supplier). Piutang = yang belum dibayar ke gerai.',
      'Layar Hutang & Pembayaran merangkum per orang, dan pelunasannya bisa dicatat lewat Una.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Siapa saja yang masih hutang?', teks: 'siapa saja yang masih hutang?' }, buka('hutangpiutang')],
    aksi: { alat: 'bayar_hutang', tawar: 'Mau Una catatkan pelunasannya? Sebut ke siapa dan berapa, mis. "bayar hutang Pak Slamet 200rb lewat Kas".', tombol: 'Una catatkan pelunasan' }
  },
  {
    id: 'laci',
    judul: 'Laci kasir',
    kunci: ['laci', 'drawer', 'buka laci', 'tutup laci', 'selisih', 'uang laci', 'kas laci'],
    isi: [
      'Laci = uang tunai di gerai. Kasir membuka laci di awal shift dan menutupnya di akhir; saldo awal otomatis melanjutkan saldo akhir sebelumnya.',
      'Yang menggerakkan laci hanya pembayaran tunai. Selisih saat tutup langsung kelihatan di laporan laci.',
      'Una sengaja tidak menyentuh uang laci — itu urusan kasir.'
    ].join('\n'),
    tawaran: [buka('drawers')],
    tanpaAksi: 'uang laci urusan kasir; Una sengaja tidak menyentuhnya'
  },
  {
    id: 'persetujuan',
    judul: 'Persetujuan (permit)',
    kunci: ['permit', 'izin', 'persetujuan', 'acc', 'approval', 'void', 'hapus transaksi'],
    isi: [
      'Hal sensitif yang diminta kasir (hapus transaksi, ambil uang kas, tutup laci kasir lain, koreksi presensi) masuk ke Persetujuan dulu.',
      'Pemilik/admin yang menyetujui atau menolak — jadi tidak ada yang hilang diam-diam.'
    ].join('\n'),
    tawaran: [buka('approvals')],
    tanpaAksi: 'ACC/tolak diputuskan Admin di layar Persetujuan, bukan lewat chat'
  },
  {
    id: 'presensi',
    judul: 'Presensi & titik lokasi',
    kunci: ['presensi', 'absen', 'gps', 'radius', 'titik lokasi', 'lokasi gerai', 'jadwal shift', 'telat'],
    isi: [
      'Karyawan absen dengan foto langsung + jam + lokasi GPS dari HP.',
      'Titik lokasi gerai diisi di Profil Toko; absen di luar radiusnya tetap tercatat tapi ditandai merah, dan karyawan bisa mengajukan perbaikan.',
      'Dari presensi, gaji per jam/per sesi terhitung sendiri.'
    ].join('\n'),
    tawaran: [buka('store'), buka('attendance-report')],
    tanpaAksi: 'presensi dilakukan karyawan dari HP-nya sendiri'
  },
  {
    id: 'akun_kasir',
    judul: 'Akun kasir dan karyawan',
    kunci: ['akun kasir', 'buat kasir', 'kasir baru', 'karyawan', 'pin kasir', 'login kasir', 'username kasir'],
    isi: [
      'Akun kasir = login untuk berjualan dan presensi (username + password). Karyawan = data orangnya (nama, HP), dipakai presensi dan gaji; satu karyawan bisa ditautkan ke akun kasirnya.',
      'Una bisa membuatkan keduanya sekaligus. Password dibuat sistem saat Bos menekan "Ya" dan ditampilkan sekali — tidak pernah lewat mesin AI.'
    ].join('\n'),
    tawaran: [buka('cashiers'), buka('employees')],
    aksi: { alat: 'buat_karyawan', tawar: 'Mau Una buatkan akunnya? Bilang "buatin", atau langsung sebut nama + username, mis. "buatin akun Rika Nur username rika, gaji 12rb per jam".', tombol: 'Una buatkan akun', awal: { kr_akun: true } }
  },
  {
    id: 'cara_bayar',
    judul: 'Cara bayar',
    kunci: ['cara bayar', 'metode bayar', 'qris', 'transfer', 'tunai', 'payment method'],
    isi: [
      'Cara bayar = tunai, transfer, QRIS, dll., diatur per gerai dan masing-masing tertaut ke akun (Kas, Bank, Rekening Bersama).',
      'Hanya tunai yang menggerakkan uang laci. Aplikasi ini mencatat cara bayarnya — uangnya sendiri tidak diproses aplikasi.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Cara bayar gerai ini apa saja?', teks: 'cara bayar gerai ini apa saja dan akunnya apa?' }],
    aksi: { alat: 'atur_cara_bayar', tawar: 'Mau Una atur cara bayarnya? Sebut mis. "QRIS masuk ke Bank BCA".', tombol: 'Una aturkan' }
  },
  {
    id: 'jualan_pertama',
    judul: 'Jualan pertama',
    kunci: ['jualan pertama', 'cara jualan', 'cara jual', 'mulai jualan', 'transaksi pertama', 'kasir jualan'],
    isi: [
      'Kasir login di halaman Kasir (HP atau komputer gerai) dengan akun kasirnya, membuka laci, lalu memilih menu dan menekan bayar.',
      'Begitu ada penjualan, untung-rugi, stok, dan pembukuan jalan sendiri — dan Bos bisa langsung tanya Una "untung hari ini berapa?".'
    ].join('\n'),
    tawaran: [jelas('laci', 'Apa itu laci kasir?')],
    tanpaAksi: 'penjualan dilakukan kasir di halaman Kasir'
  },
  {
    id: 'gerai_entity',
    judul: 'Gerai dan entity',
    kunci: ['entity', 'apa itu gerai', 'gerai dan entity', 'badan usaha', 'semua gerai', 'beda gerai dan entity'],
    isi: [
      'Gerai = satu toko/outlet. Entity = usahanya (pemilik buku), yang membawahi beberapa gerai.',
      'Data tiap gerai terpisah rapi; laporan entity menjumlahkan semuanya. Di Una, pilih gerai lewat tombol ▾ di atas, atau "semua gerai" untuk tingkat entity.'
    ].join('\n'),
    tawaran: [],
    tanpaAksi: 'penjelasan istilah'
  },

  // --- barang, stok, supplier, pembelian -----------------------------------------
  // Uji karyawan Bos Cyo 2026-10-11: 14 pertanyaan "bagaimana cara …" soal barang dan
  // stok dijawab "belum punya penjelasan" atau diarahkan ke layar yang salah (restock →
  // "gerai dan entity", nota supplier → jadwal kerja). Isinya dicocokkan ke layar
  // sungguhan: public/branch-admin.html (form Tambah barang/kategori/supplier),
  // public/admin-stock.js (Lihat Mutasi), public/cashier-procurement-ui.js (Beli Bahan),
  // public/cashier-approval-actions.js (Penyesuaian Stok, Arus Barang).
  {
    id: 'barang_tambah',
    judul: 'Menambah barang baru',
    kunci: ['tambah barang', 'barang baru', 'menambahkan barang', 'input barang', 'daftar barang', 'nama barang', 'masukin barang', 'produk baru', 'menu baru', 'bikin barang', 'buat barang'],
    isi: [
      'Di Workspace Gerai, buka Barang → Daftar Barang. Form "Tambah barang" ada di kiri:',
      '• Nama barang, Harga beli (modal per satuan; boleh koma, mis. 0,5), Harga jual, Kategori, dan Foto (opsional).',
      '• Centang "Aktif dijual" supaya muncul di kasir, lalu Simpan barang.',
      'Untuk bahan baku (gula, cup, susu), atur juga Peran Barang dan Satuan Dasar (gram/ml/pcs) di bagian bawah form, supaya stok dan resepnya pas.',
      'Banyak barang sekaligus? Ketik daftarnya ke Una atau kirim foto papan menu.'
    ].join('\n'),
    tawaran: [buka('products'), isi('Masukin daftar menu', 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb')],
    aksi: { alat: 'buat_barang', tawar: 'Mau Una yang tambahkan? Bilang "buatin", atau langsung mis. "bikin barang Es Teh harga 5rb, harga beli 2rb, kategori Minuman".', tombol: 'Una tambahkan barang' }
  },
  {
    id: 'harga_barang',
    judul: 'Mengisi / mengubah harga beli & harga jual',
    kunci: ['harga beli', 'harga jual', 'ubah harga', 'ganti harga', 'ganti harga jual', 'memasukkan harga', 'isi harga', 'naikin harga', 'harga modal'],
    isi: [
      'Barang baru: isi Harga beli dan Harga jual di form "Tambah barang" (Barang → Daftar Barang).',
      'Barang yang sudah ada: cari di daftar kanan → Edit → ubah harganya → Simpan barang. Harga jual baru langsung dipakai kasir.',
      'Harga beli di sini = harga bawaan saat kasir mencatat Beli Bahan (tetap bisa diubah di kasir). Modal rata-rata (HPP) dihitung sendiri dari pembelian.',
      'Lebih cepat lewat Una: "harga es teh jadi 7rb" atau beberapa sekaligus.'
    ].join('\n'),
    tawaran: [buka('products')],
    aksi: { alat: 'ubah_barang', tawar: 'Mau Una ubahkan harganya? Sebut barang dan harga barunya, mis. "harga es teh jadi 7rb, harga beli 2.500".', tombol: 'Una ubahkan harga' }
  },
  {
    id: 'kategori_barang',
    judul: 'Kategori barang',
    kunci: ['kategori', 'kategori barang', 'kategori baru', 'menentukan kategori', 'kelompok barang', 'golongan barang'],
    isi: [
      'Kategori = pengelompokan barang di menu kasir (mis. Minuman, Makanan, Snack).',
      'Buat kategori baru di Barang → Kategori → "Tambah kategori": isi Nama kategori (Kategori induk boleh dikosongkan), centang Aktif, Simpan kategori.',
      'Lalu saat Tambah barang / Edit barang, pilih kategorinya di kolom Kategori. Kategori yang dinonaktifkan tidak menghapus barangnya.'
    ].join('\n'),
    tawaran: [buka('categories'), buka('products')],
    aksi: { alat: 'buat_kategori', tawar: 'Mau Una buatkan kategorinya? Sebut namanya, mis. "bikin kategori Minuman Dingin". Memindah barang: "pindahin es teh ke kategori Minuman Dingin".', tombol: 'Una buatkan kategori' }
  },
  {
    id: 'barang_nonaktif',
    judul: 'Menonaktifkan barang (tanpa menghapus riwayat)',
    kunci: ['nonaktifkan barang', 'menonaktifkan', 'nonaktif', 'tidak dijual', 'sudah tidak dijual', 'hapus barang', 'menghapus barang', 'sembunyikan barang', 'stop jual', 'tidak dipakai lagi'],
    isi: [
      'Di Barang → Daftar Barang, cari barangnya lalu tekan "Nonaktifkan" (atau Edit → hilangkan centang "Aktif dijual" → Simpan barang).',
      'Barang hanya hilang dari menu kasir. Riwayat transaksi, stok, HPP, dan laporan lamanya TETAP utuh — memang tidak ada tombol hapus permanen.',
      'Mau dijual lagi? Edit barangnya dan centang "Aktif dijual".'
    ].join('\n'),
    tawaran: [buka('products')],
    aksi: { alat: 'nonaktifkan_barang', tawar: 'Mau Una nonaktifkan? Sebut barangnya, mis. "nonaktifkan Es Teh Leci dan Roti Bakar".', tombol: 'Una nonaktifkan' }
  },
  {
    id: 'supplier_tambah',
    judul: 'Mendaftarkan supplier baru',
    kunci: ['supplier', 'suplier', 'supplier baru', 'suplier baru', 'tambah supplier', 'daftar supplier', 'pemasok', 'vendor'],
    isi: [
      'Di Workspace Gerai, buka Barang → Supplier → form "Tambah supplier".',
      'Isi Nama supplier, No. HP, Alamat, dan Catatan kalau perlu, centang Aktif, lalu Simpan supplier.',
      'Supplier yang aktif muncul di pilihan "Supplier" saat kasir mencatat Beli Bahan, jadi hutang dan uang muka ke supplier itu terlacak per nama.'
    ].join('\n'),
    tawaran: [buka('suppliers')],
    aksi: { alat: 'buat_supplier', tawar: 'Mau Una daftarkan? Bilang "buatin", atau langsung mis. "tambah supplier Toko Makmur hp 0812…, alamat Pasar Baru".', tombol: 'Una daftarkan supplier' }
  },
  {
    id: 'pembelian',
    judul: 'Mencatat pembelian / restock barang',
    kunci: ['pembelian', 'beli bahan', 'restock', 'restok', 're stock', 'belanja bahan', 'kulakan', 'barang masuk dari supplier', 'mencatat pembelian', 'stok masuk', 'tambah stok', 'menambah stok', 'baru dibeli', 'yang dibeli', 'ke stok', 'masuk stok'],
    isi: [
      'Pembelian/restock dicatat di aplikasi Kasir (laci harus sedang dibuka): tekan "🧺 Beli Bahan".',
      '• Pilih Supplier (atau "Tanpa supplier") dan Cara bayar: Cash/Kas, Bank/Transfer, atau Hutang.',
      '• Pilih Barang, isi Qty, lalu Total belanja baris itu (atau ganti ke "Isi Harga per Satuan") → "＋ Tambah Baris Barang". Ulangi untuk barang lain.',
      '• SIMPAN PEMBELIAN. Stok langsung bertambah dan modal rata-rata (HPP) diperbarui.',
      'Barangnya harus sudah ada di Daftar Barang. Kalau sudah bayar uang muka ke supplier, pilih "Bayar dari Deposit".',
      'Una sengaja tidak mencatat pembelian — uangnya keluar dari laci/rekening, jadi tetap lewat kasir.'
    ].join('\n'),
    tawaran: [jelas('nota_beda', 'Jumlah datang beda dari nota?'), jelas('barang_rusak', 'Barang rusak saat diterima?')],
    tanpaAksi: 'pembelian menggerakkan uang laci/rekening, jadi tetap dicatat kasir (Una tidak menyentuh kas)'
  },
  {
    id: 'nota_beda',
    judul: 'Barang datang tidak sama dengan nota supplier',
    kunci: ['nota supplier', 'nota suplier', 'berbeda dari nota', 'beda dari nota', 'tidak sesuai nota', 'jumlah berbeda', 'kurang dari nota', 'lebih dari nota', 'barang kurang', 'kiriman kurang', 'jumlahnya berbeda'],
    isi: [
      'Pegangannya: stok mengikuti barang yang BENAR-BENAR datang, uang mengikuti yang BENAR-BENAR dibayar/ditagih.',
      '• Di Beli Bahan, isi Qty sesuai yang datang dan Total sesuai tagihan untuk barang yang datang itu. Tulis selisihnya di Catatan (mis. "nota 10, datang 8").',
      '• Sudah terlanjur bayar penuh padahal barang kurang? Kekurangannya jadi uang muka (Deposit) ke supplier itu; nanti pembelian berikutnya pilih "Bayar dari Deposit".',
      '• Supplier akan mengirim susulan dan ditagih belakangan? Catat yang datang sekarang saja; susulannya dicatat Beli Bahan lagi saat datang.',
      'Terlanjur dicatat sesuai nota? Stoknya dibetulkan lewat Penyesuaian Stok di kasir (di-ACC Admin).'
    ].join('\n'),
    tawaran: [jelas('penyesuaian_stok', 'Cara Penyesuaian Stok'), jelas('deposit', 'Apa itu uang muka / deposit?')],
    aksi: { alat: 'buat_uang_muka', tawar: 'Ada kelebihan bayar ke supplier yang perlu dicatat sebagai deposit? Una bisa catatkan, mis. "uang muka ke Toko Makmur 300rb lewat transfer bank".', tombol: 'Una catatkan deposit' }
  },
  {
    id: 'barang_rusak',
    judul: 'Barang rusak (saat diterima atau di gerai)',
    kunci: ['rusak', 'barang rusak', 'rusak saat diterima', 'cacat', 'pecah', 'basi', 'kedaluwarsa', 'expired', 'busuk', 'tumpah', 'retur'],
    isi: [
      'Rusak saat diterima dan belum dicatat: di Beli Bahan isi Qty yang BAGUS saja, Total sesuai yang dibayar. Kalau supplier mengganti/mengembalikan uang belakangan, catat penggantinya sebagai Beli Bahan lagi saat datang.',
      'Sudah terlanjur masuk stok (atau rusak di gerai): di Kasir tekan "📦 Arus Barang" → Arah arus "Barang Keluar" → pilih barang, Qty yang rusak, Catatan mis. "rusak saat diterima" → AJUKAN ARUS BARANG.',
      'Stok baru berkurang setelah Admin/Owner meng-ACC di Transaksi → Persetujuan. Nilainya dihitung dari modal (HPP) barang itu, jadi kerugiannya ikut tercatat.'
    ].join('\n'),
    tawaran: [buka('approvals'), jelas('barang_keluar', 'Barang keluar untuk pemakaian gerai')],
    tanpaAksi: 'barang keluar diajukan kasir lewat Arus Barang dan di-ACC Admin di layar Persetujuan'
  },
  {
    id: 'barang_keluar',
    judul: 'Barang keluar untuk kebutuhan internal gerai',
    kunci: ['barang keluar', 'kebutuhan internal', 'pemakaian internal', 'dipakai sendiri', 'pemakaian sendiri', 'konsumsi karyawan', 'dipakai gerai', 'keperluan gerai', 'arus barang', 'sampel', 'tester'],
    isi: [
      'Di aplikasi Kasir tekan "📦 Arus Barang": pilih barang, Arah arus "Barang Keluar", isi Qty, dan Catatan untuk apa (mis. "dipakai bersih-bersih", "makan karyawan") → AJUKAN ARUS BARANG.',
      'Kasir tidak langsung mengubah stok: setelah Admin/Owner ACC di Transaksi → Persetujuan, stok dan pembukuannya berubah bersamaan (nilainya dari modal/HPP).',
      'Barang yang dipakai rutin lewat resep (gula untuk es teh) tidak perlu dicatat begini — sudah berkurang otomatis saat menunya terjual.'
    ].join('\n'),
    tawaran: [buka('approvals'), buka('stock')],
    tanpaAksi: 'barang keluar diajukan kasir lewat Arus Barang dan di-ACC Admin di layar Persetujuan'
  },
  {
    id: 'penyesuaian_stok',
    judul: 'Penyesuaian stok (hasil hitung fisik)',
    kunci: ['penyesuaian stok', 'menyesuaikan stok', 'koreksi stok', 'stok opname', 'opname', 'hitung fisik', 'stok fisik', 'stok tidak sesuai', 'stok salah', 'betulkan stok', 'adjust stok'],
    isi: [
      'Di aplikasi Kasir tekan "🧮 Penyesuaian Stok": pilih barang (stok sistemnya terlihat), isi "Target stok fisik" = hasil hitung, dan Alasan (mis. "hasil hitung fisik") → AJUKAN PENYESUAIAN.',
      'Admin/Owner meng-ACC di Transaksi → Persetujuan. Saat ACC stoknya dicek ulang — kalau sudah berubah karena transaksi lain, pengajuan ditolak dan perlu diajukan ulang.',
      'Sebelum menyesuaikan, cek dulu mutasinya (Barang → Stok → Lihat Mutasi): sering kali penyebabnya pembelian yang belum dicatat atau resep yang takarannya salah.'
    ].join('\n'),
    tawaran: [buka('stock'), buka('approvals')],
    tanpaAksi: 'penyesuaian stok diajukan kasir (hitung fisik di gerai) dan di-ACC Admin di layar Persetujuan'
  },
  {
    id: 'riwayat_stok',
    judul: 'Melihat riwayat keluar-masuk barang',
    kunci: ['riwayat stok', 'keluar masuk', 'keluar masuk barang', 'mutasi stok', 'mutasi barang', 'histori stok', 'riwayat barang', 'kartu stok', 'pergerakan stok'],
    isi: [
      'Buka Barang → Stok, cari barangnya, lalu tekan "📦 Lihat Mutasi".',
      'Tiap baris = satu gerakan: ＋ masuk / − keluar, jumlahnya, dari mana (Penjualan, Pembelian, Arus Barang, Produksi, Penyesuaian stok), tanggal-jam, dan catatannya.',
      '"📈 Histori HPP" di sebelahnya menunjukkan perubahan modal rata-rata barang itu dari waktu ke waktu.'
    ].join('\n'),
    tawaran: [buka('stock'), { jenis: 'kirim', label: 'Stok tinggal berapa?', teks: 'stok barang yang tinggal sedikit apa aja?' }],
    tanpaAksi: 'riwayat mutasi dibaca di layar Stok; angka stok sekarang bisa ditanyakan langsung ("stok gula tinggal berapa?")'
  },

  // --- karyawan, presensi, gaji, setoran CS ---------------------------------------
  // Uji karyawan Bos Cyo 2026-10-10: sembilan pertanyaan "bagaimana cara ..." soal CS
  // dijawab "Una belum punya penjelasan". Isinya dicocokkan ke layar sungguhan
  // (public/admin-cashiers.js, admin-employees.js, admin-employee-deposits.js,
  // src/staff-attendance.js, attendance-correction-permit.js, entity-backup-cashiers.js).
  {
    id: 'karyawan_tambah',
    judul: 'Menambah karyawan',
    kunci: ['tambah karyawan', 'menambah karyawan', 'karyawan baru', 'daftar karyawan', 'nama karyawan', 'input karyawan', 'data karyawan', 'rekrut'],
    isi: [
      'Di Workspace Gerai, buka Tim → Karyawan → "Tambah karyawan".',
      'Isi Nama lengkap (mis. Rika Nur), No. HP, No. identitas, dan alamat kalau ada, lalu Simpan karyawan.',
      'Supaya dia bisa login dan presensi, buatkan juga akunnya di Tim → Akun Kasir, lalu kembali ke Karyawan dan tekan "Tautkan" ke username itu.',
      'Atau suruh Una: karyawan, akun login, dan tautannya dibuat sekaligus. Password akun dibuat sistem dan ditampilkan sekali — tidak pernah lewat mesin AI.'
    ].join('\n'),
    tawaran: [buka('employees'), buka('cashiers'), jelas('akun_cs', 'Bikin akun CS + jam kerja')],
    aksi: { alat: 'buat_karyawan', tawar: 'Mau Una yang buatkan? Bilang "buatin", atau langsung sebut namanya, mis. "tambah karyawan Rika Nur hp 0812…" — sekalian akun login kalau perlu.', tombol: 'Una buatkan karyawan' }
  },
  {
    id: 'akun_cs',
    judul: 'Membuat akun CS + jam kerja',
    kunci: ['akun cs', 'akun kasir', 'akun karyawan', 'buat akun', 'bikin akun', 'membuat akun', 'jam kerja', 'hari kerja', 'jadwal kerja', 'jadwal cs', 'shift', 'libur', 'gaji per jam', 'username'],
    isi: [
      'Buka Tim → Akun Kasir → "Tambah kasir":',
      '• Username dan Password (min. 6 huruf) — ini yang dipakai CS untuk login dan presensi.',
      '• Nama karyawan (mis. Rika Nur) dan Jenis pekerjaan (mis. "CS").',
      '• Jenis pembayaran: Per Jam atau Per Sesi, lalu Gaji per jam.',
      '• Jam & hari kerja per hari: isi jam masuk–pulang tiap hari. Contoh: Senin 09.00–22.00, Selasa sampai Sabtu 09.00–18.00, Minggu centang "Libur".',
      'Simpan kasir, lalu di tab Karyawan tautkan username itu ke orangnya.',
      'Jadwal ini yang dipakai untuk menandai telat; presensi di luar jadwal tidak dihitung gaji.'
    ].join('\n'),
    tawaran: [buka('cashiers'), jelas('jadwal_beda', 'Jam masuk tiap hari beda?')],
    aksi: { alat: 'buat_karyawan', tawar: 'Mau Una buatkan akunnya? Bilang "buatin", atau langsung mis. "buatin akun Rika Nur username rika, gaji 12rb per jam, Senin–Sabtu 09.00–17.00, Minggu libur".', tombol: 'Una buatkan akun', awal: { kr_akun: true } }
  },
  {
    id: 'jadwal_beda',
    judul: 'Jam masuk CS tiap hari berbeda',
    kunci: ['jam masuk', 'jam masuknya', 'jam masuk berbeda', 'jam kerja beda', 'tiap hari beda', 'jadwal beda', 'ganti shift', 'jadwal berubah'],
    isi: [
      'Bisa. Jadwal di Akun Kasir diisi PER HARI, jadi tiap hari boleh beda jam masuk–pulangnya, dan hari libur dicentang "Libur".',
      'Ubah lewat Tim → Akun Kasir → Edit pada akun CS itu → bagian "Jam & hari kerja" → Simpan kasir.',
      'Telat dinilai dari jadwal hari itu. Hari yang libur atau belum diisi jadwalnya tidak dinilai telat.',
      'Kalau shift-nya beda orang (pagi/sore), lebih rapi bikin akun per shift (mis. "Kasir Shift Pagi"), karena jadwal menempel ke akun, bukan ke orangnya.'
    ].join('\n'),
    tawaran: [buka('cashiers')],
    aksi: { alat: 'atur_jadwal_kasir', tawar: 'Mau Una ubahkan jadwalnya? Sebut nama CS + jadwalnya, mis. "jadwal Rika: Senin 09.00–22.00, Selasa–Sabtu 09.00–18.00, Minggu libur".', tombol: 'Una ubahkan jadwal' }
  },
  {
    id: 'setoran_cs',
    judul: 'Rekap setoran CS',
    kunci: ['setoran cs', 'setoran', 'rekap setoran', 'setor', 'bukti transfer', 'uang laci dibawa', 'piutang cs', 'piutang karyawan'],
    isi: [
      'Buka Keuangan → Setoran CS. Isinya tiga bagian:',
      '• Setoran menunggu ACC — CS mengirim foto bukti transfer dari Portal Staf (Riwayat Setoran); cocokkan dengan mutasi rekening lalu ACC atau tolak.',
      '• Sisa piutang setoran per CS — uang laci yang belum diserahkan ke kantor (masih "dibawa" CS).',
      '• Riwayat setoran — semua yang sudah diputuskan.',
      'Piutang CS baru berkurang setelah Admin klik ACC; tidak ada ACC otomatis.',
      'Mau angkanya sekarang? Tanya Una "setoran CS yang masih dibawa siapa aja?".'
    ].join('\n'),
    tawaran: [buka('setoran-cs'), { jenis: 'kirim', label: 'Setoran yang masih dibawa?', teks: 'setoran cs yang masih dibawa siapa aja?' }],
    aksi: { alat: 'cek_setoran_cs', tawar: 'Mau Una cekkan angkanya sekarang?', tombol: 'Una cekkan' }
  },
  {
    id: 'gaji_harian',
    judul: 'Melihat gaji harian CS',
    kunci: ['gaji harian', 'gaji cs', 'gaji karyawan', 'honor', 'riwayat gaji', 'gaji per hari', 'hitung gaji', 'gajian'],
    isi: [
      'Gaji harian terhitung sendiri dari presensi: Per Jam = gaji per jam × jam kerja sebenarnya (jam masuk sampai pulang), Per Sesi = nominal per sesi.',
      '• Per akun: Tim → Akun Kasir → tombol "💰 Gaji" pada akun CS itu — kartu per tanggal.',
      '• Per orang (lintas akun & gerai): Tim → Karyawan → klik namanya → Riwayat Gaji, lengkap dengan saldo hutang gaji.',
      'Presensi di luar jadwal ditandai "Di luar jadwal, tidak dihitung".'
    ].join('\n'),
    tawaran: [buka('cashiers'), buka('employees'), jelas('potongan_gaji', 'Potongan / bonus gaji')],
    tanpaAksi: 'gaji dihitung otomatis dari presensi; dibaca di layar Gaji per akun'
  },
  {
    id: 'potongan_gaji',
    judul: 'Potongan, bonus, dan penyesuaian gaji',
    kunci: ['potongan', 'potong gaji', 'denda', 'tidak masuk', 'bolos', 'bonus', 'lembur', 'penyesuaian gaji', 'tambahan gaji'],
    isi: [
      'Buka Tim → Akun Kasir → "💰 Gaji" pada akun CS itu → bagian Penyesuaian Gaji.',
      'Isi tanggal, Nominal (Rp) — angka NEGATIF = potongan, positif = bonus/lembur — dan alasannya, lalu Simpan Penyesuaian.',
      'Hari yang tidak masuk (tidak ada presensi) memang tidak menghasilkan gaji otomatis; penyesuaian dipakai kalau ada denda tambahan.',
      'Salah input? Penyesuaian bisa dibatalkan dengan alasan — tidak dihapus diam-diam, tetap tercatat jejaknya.'
    ].join('\n'),
    tawaran: [buka('cashiers')],
    aksi: { alat: 'penyesuaian_gaji', tawar: 'Mau Una catatkan potongan/bonusnya? Sebut nama, nominal, tanggal, dan alasan, mis. "potong gaji Rika 20rb kemarin karena telat".', tombol: 'Una catatkan' }
  },
  {
    id: 'telat_gaji',
    judul: 'Gaji kalau CS terlambat',
    kunci: ['terlambat', 'telat', 'keterlambatan', 'datang telat', 'masuk telat', 'cs terlambat', 'karyawan terlambat', 'karyawan telat', 'yang telat', 'gaji terlambat', 'cs telat'],
    isi: [
      'Telat ditandai otomatis ("Telat X menit") dengan membandingkan jam presensi masuk dengan jadwal hari itu.',
      'Untuk gaji Per Jam, jam kerja dihitung dari jam presensi sebenarnya — jadi telat otomatis mengurangi gaji hari itu, tanpa perlu diatur.',
      'Kalau mau ada denda tambahan: Tim → Akun Kasir → "💰 Gaji" → Penyesuaian Gaji dengan nominal negatif + alasan.',
      'Kalau telatnya karena alasan sah (mis. aplikasi error), CS mengajukan koreksi jam masuk dari Portal Staf SEBELUM presensi pulang; Admin meng-ACC di Akun Kasir → "Pengajuan koreksi presensi".'
    ].join('\n'),
    tawaran: [buka('cashiers'), buka('attendance-report')],
    aksi: { alat: 'penyesuaian_gaji', tawar: 'Mau Una catatkan dendanya? Sebut mis. "potong gaji Rika 20rb kemarin karena telat".', tombol: 'Una catatkan denda', awal: { pg_jenis: 'potong' } }
  },
  {
    id: 'presensi_gagal',
    judul: 'CS tidak bisa presensi',
    kunci: ['tidak bisa presensi', 'gagal presensi', 'tidak presensi', 'lupa presensi', 'lupa absen', 'tidak absen', 'gagal absen', 'tidak ada rekap presensi', 'presensi hilang', 'koreksi presensi'],
    isi: [
      'Tergantung kapan ketahuannya:',
      '• Masih di hari kerja dan sudah presensi masuk tapi jamnya salah → CS ajukan koreksi dari Portal Staf sebelum presensi pulang; Admin ACC di Akun Kasir → "Pengajuan koreksi presensi". Jam yang di-ACC langsung dipakai menghitung gaji.',
      '• Tidak presensi sama sekali di hari itu → memang tidak ada data presensi, jadi gajinya tidak terhitung otomatis. Tambahkan lewat Akun Kasir → "💰 Gaji" → Penyesuaian Gaji (nominal positif) dengan alasan "tidak bisa presensi tgl …".',
      '• Lupa presensi pulang → sesi ditutup otomatis sistem dan ditandai di Laporan Presensi; koreksinya lewat Penyesuaian Gaji.',
      'Semua pengajuan dan keputusan terlihat di Laporan → Izin & Koreksi.'
    ].join('\n'),
    tawaran: [buka('attendance-report'), buka('permit-report'), buka('cashiers')],
    aksi: { alat: 'penyesuaian_gaji', tawar: 'Mau Una tambahkan gaji hari yang tidak terhitung? Sebut mis. "tambah gaji Rika 80rb tgl 5 karena tidak bisa presensi".', tombol: 'Una tambahkan gaji', awal: { pg_jenis: 'tambah' } }
  },
  {
    id: 'backup_salah_gerai',
    judul: 'Akun CS backup diaktifkan di gerai yang salah',
    kunci: ['backup', 'back up', 'cs backup', 'akun backup', 'lintas gerai', 'salah gerai', 'salah mengaktifkan', 'aktifkan backup'],
    isi: [
      'Akun backup lintas gerai harus diaktifkan Admin per hari (Akun Kasir → "✅ Aktifkan gerai ini hari ini"), dan satu akun hanya bisa aktif di SATU gerai per hari.',
      'Kalau terlanjur diaktifkan di gerai yang salah (mis. Beji, padahal harusnya Pendem), gerai lain akan DITOLAK saat mengaktifkan akun itu di hari yang sama.',
      'Belum ada tombol untuk membatalkan aktivasi dari layar. Pilihannya hari itu: CS backup presensi pakai akunnya sendiri di Pendem kalau punya, atau minta Entity Admin/tim membetulkan datanya. Besok cukup aktifkan di gerai yang benar.',
      'Supaya tidak terulang: cek tulisan "Aktif di gerai …" di baris akun backup sebelum menekan tombol aktifkan.'
    ].join('\n'),
    tawaran: [buka('cashiers')],
    tanpaAksi: 'belum ada jalur membatalkan aktivasi backup — dari layar pun belum bisa'
  }
].map((entri) => Object.freeze(entri)));


const KOSAKATA = new Map(KAMUS.map((entri) => [entri, kataInti([...entri.kunci, entri.judul].join(' '))]));

/**
 * Mencari entri kamus untuk satu pertanyaan/topik. Skor = frasa kunci yang muncul utuh
 * (makin panjang makin kuat) + kata bermakna pertanyaan yang ada di kosakata entri.
 * Uji 2026-10-10: "salah mengaktifkan akun cs back up ... gerai pendem ... gerai beji"
 * dulu jatuh ke "gerai dan entity" karena hanya mencari frasa terpanjang.
 * @returns {object|null}
 */
export function cariTopikSkor(teks) {
  const kalimat = ` ${normalkan(teks)} `;
  if (!kalimat.trim()) return null;
  const langsung = KAMUS.find((entri) => entri.id === String(teks ?? '').trim());
  if (langsung) return { entri: langsung, skor: 99 };
  const kataTanya = kataInti(teks);
  let terbaik = null;
  for (const entri of KAMUS) {
    let skor = 0;
    for (const kunci of entri.kunci) {
      const k = normalkan(kunci);
      if (k && kalimat.includes(` ${k} `)) skor += 2 + k.split(' ').length;
    }
    for (const kata of kataTanya) if (KOSAKATA.get(entri).has(kata)) skor += 1;
    if (!terbaik || skor > terbaik.skor) terbaik = { entri, skor };
  }
  return terbaik && terbaik.skor >= 3 ? terbaik : null;
}

/**
 * Beberapa entri kamus terdekat (skor tertinggi dulu) — bahan bagi Gemini untuk memeriksa
 * mana yang benar-benar menjawab pertanyaan (src/caca-poles.js). Skor minimal 2: lebih
 * longgar dari cariTopikSkor karena keputusan akhirnya di tangan pemeriksa.
 */
export function peringkatTopik(teks, n = 3) {
  const kalimat = ` ${normalkan(teks)} `;
  if (!kalimat.trim()) return [];
  const kataTanya = kataInti(teks);
  const nilai = KAMUS.map((entri) => {
    let skor = 0;
    for (const kunci of entri.kunci) {
      const k = normalkan(kunci);
      if (k && kalimat.includes(` ${k} `)) skor += 2 + k.split(' ').length;
    }
    for (const kata of kataTanya) if (KOSAKATA.get(entri).has(kata)) skor += 1;
    return { entri, skor };
  });
  return nilai.filter((x) => x.skor >= 2).sort((a, b) => b.skor - a.skor).slice(0, n);
}

export function cariTopik(teks) {
  return cariTopikSkor(teks)?.entri ?? null;
}

/** Jawaban siap tampil: kalimat + tawaran. Topik tak dikenal → daftar topik. */
export function jelaskan(teks, { halaman = 'gerai' } = {}) {
  const topik = cariTopikSkor(teks);
  // Peta menu aplikasi (dibangkitkan dari daftar menu sungguhan, src/caca-peta.js)
  // menang kalau kecocokannya lebih kuat dari panduan kamus — mis. "bikin pengumuman
  // buat karyawan" adalah menu Pengumuman, bukan panduan akun kasir.
  const cocok = cariMenu(teks, { halaman });
  // Panduan kamus yang menunjuk layar yang sama dengan menu itu selalu menang: isinya lebih lengkap.
  const layarSama = Boolean(topik && cocok && (topik.entri.tawaran ?? []).some((t) => t.layar === cocok.menu.tab));
  const entri = topik && (!cocok || layarSama || topik.skor >= cocok.skor) ? topik.entri : null;
  if (!entri) {
    if (cocok) {
      return {
        ok: true,
        dikenal: true,
        topik: `menu:${cocok.menu.tab}`,
        judul: cocok.menu.label,
        jawaban: jawabanMenu(cocok.menu),
        tawaran: cocok.menu.halaman === 'gerai' ? [{ jenis: 'buka', layar: cocok.menu.tab, label: `Buka ${cocok.menu.label}` }] : []
      };
    }
    return {
      ok: true,
      dikenal: false,
      judul: 'Topik yang bisa Una jelaskan',
      jawaban: `Una belum punya penjelasan untuk "${String(teks ?? '').trim().slice(0, 60)}". Yang ini bisa:`,
      tawaran: KAMUS.filter((e) => e.id !== 'gerai_entity').slice(0, 10).map((e) => jelas(e.id, e.judul))
    };
  }
  return { ok: true, dikenal: true, topik: entri.id, judul: entri.judul, jawaban: entri.isi, tawaran: entri.tawaran, kerjakan: entri.aksi ?? null };
}

/**
 * Panduan yang bisa dikerjakan Una sendiri ditutup dengan tawaran (Bos Cyo 2026-10-10:
 * "pastikan una juga bisa mengerjakan yang apabila ditanya mekanismenya aja"), dan
 * meninggalkan tugas tertunda bertanda `tawaran` supaya "kamu bisa buatin itu?"
 * berikutnya nyambung ke alat ini, bukan dibaca dari nol (src/caca-agen.js).
 */
export const TEKS_MINTA_KERJAKAN = 'iya, tolong kerjain ya';
export function denganTawaranKerja(hasil) {
  const k = hasil?.kerjakan;
  if (!k?.alat) return hasil;
  return {
    ...hasil,
    jawaban: `${hasil.jawaban}\n\n${k.tawar}`,
    tawaran: [{ jenis: 'kirim', label: k.tombol, teks: TEKS_MINTA_KERJAKAN }, ...(hasil.tawaran ?? [])],
    tertunda: { alat: k.alat, tangkapan: { ...(k.awal ?? {}) }, tanya: k.tawar, kurang: null, tawaran: true }
  };
}

/** Alat untuk agen: dipilih model, dijawab kode. */
export const ALAT_JELASKAN = Object.freeze({
  nama: 'jelaskan',
  lingkup: 'semua',
  baca: true,
  petunjuk: 'MENJELASKAN arti istilah atau CARA PAKAI aplikasi (semua pertanyaan "bagaimana cara ...", "gimana kalau ...", "di mana ...", "menu apa untuk ..."), mis. "HPP itu apa?", "bagaimana cara menambah karyawan?", "gimana kalau CS lupa absen?", "potongan gaji di mana?", "Una bisa apa aja?". BUKAN untuk pesan yang merujuk percakapan tadi, menyebut barang/gerai tertentu, atau meminta tindakan.',
  skema: {
    jelaskan_topik: { type: 'string', description: 'jelaskan: istilah atau hal yang ditanyakan, PERSIS seperti ditulis.' }
  },
  async siapkan(t, ctx = {}) {
    // Topik salinan model kadang terlalu pendek/terlalu panjang; kalimat Bos utuh jadi cadangan.
    const halaman = ctx.lingkup === 'entity' ? 'entity' : 'gerai';
    let hasil = jelaskan(t?.jelaskan_topik, { halaman });
    if (!hasil.dikenal && ctx.pesan) {
      const dariPesan = jelaskan(ctx.pesan, { halaman });
      if (dariPesan.dikenal) hasil = dariPesan;
    }
    return { ok: true, jawaban: hasil.jawaban, tawaran: hasil.tawaran, kerjakan: hasil.kerjakan ?? null };
  }
});
