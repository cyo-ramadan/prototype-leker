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
  'permit-report': { label: 'Izin & Koreksi', halaman: 'gerai' }
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
      'Yang tetap di kasir: penjualan, pembelian, dan uang laci. Akun kasir dibuat di layarnya sendiri karena ada PIN.'
    ].join('\n'),
    tawaran: [
      isi('Masukin daftar menu', 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb'),
      { jenis: 'kirim', label: 'Untung hari ini?', teks: 'untung hari ini berapa?' },
      jelas('mulai', 'Mulai dari mana?')
    ]
  },
  {
    id: 'mulai',
    judul: 'Mulai dari mana',
    kunci: ['mulai dari mana', 'cara mulai', 'langkah awal', 'baru pertama', 'pertama kali', 'cara pakai', 'gimana makenya', 'bingung'],
    isi: [
      'Urutan paling cepat sampai bisa jualan:',
      '1. Daftar menu — kirim foto papan menu atau ketik daftarnya, Una yang masukin.',
      '2. Akun kasir — dibuat di layar Akun Kasir (ada PIN, jadi tidak lewat chat).',
      '3. Kasir membuka laci di HP/komputer kasir, lalu jualan pertama.',
      'Bahan & resep, karyawan, dan titik lokasi presensi bisa menyusul — dan Una ingatkan.'
    ].join('\n'),
    tawaran: [
      { jenis: 'foto_menu', label: '📷 Foto daftar menu' },
      isi('✍️ Ketik daftar menu', 'masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb'),
      buka('cashiers')
    ]
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
    tawaran: [jelas('resep', 'Apa itu resep?'), { jenis: 'kirim', label: 'Barang yang HPP-nya di atas harga jual', teks: 'barang mana yang HPP-nya di atas harga jual?' }]
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
    ]
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
    tawaran: [buka('products')]
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
    tawaran: [buka('products')]
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
    tawaran: [buka('manufacturing')]
  },
  {
    id: 'stok_minus',
    judul: 'Stok minus',
    kunci: ['stok minus', 'minus', 'stok negatif', 'negatif'],
    isi: [
      'Stok minus bukan error: artinya barangnya sudah terjual sebelum pembeliannya dicatat.',
      'Begitu pembelian dicatat di kasir, stoknya kembali sesuai. Angkanya sengaja tidak disembunyikan supaya ketahuan ada pembelian yang belum dicatat.'
    ].join('\n'),
    tawaran: [buka('stock')]
  },
  {
    id: 'untung_rugi',
    judul: 'Untung rugi',
    kunci: ['untung rugi', 'laba rugi', 'laba', 'untung', 'net profit', 'rugi', 'omzet', 'omset'],
    isi: [
      'Omzet = total penjualan. Untung kotor = omzet − HPP. Untung bersih = untung kotor − beban (gaji, sewa lapak, dll).',
      'Semuanya terhitung sendiri dari penjualan, pembelian, dan biaya yang dicatat — tidak perlu rekap manual.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Untung hari ini?', teks: 'untung hari ini berapa?' }, buka('labarugi')]
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
    tawaran: [isi('Contoh jurnal setoran modal', 'jurnal setoran modal 5jt: debit Bank, kredit Modal Pemilik'), buka('accountingWorkspaceTab')]
  },
  {
    id: 'akun',
    judul: 'Akun (bagan akun)',
    kunci: ['akun', 'coa', 'bagan akun', 'chart of account', 'kode akun'],
    isi: [
      'Akun = "laci" pembukuan tempat uang dan nilai dicatat: Kas, Bank, Persediaan, Penjualan, HPP, Beban, Modal, dst.',
      'Bagan akun standar sudah disiapkan sama di semua gerai, jadi pemilik tidak perlu membuatnya.'
    ].join('\n'),
    tawaran: [buka('accountingWorkspaceTab')]
  },
  {
    id: 'rekening_bersama',
    judul: 'Rekening Bersama',
    kunci: ['rekening bersama', 'rekber', 'shared account', 'rekening'],
    isi: [
      'Rekening Bersama = satu rekening bank yang dipakai beberapa gerai sekaligus.',
      'Tiap gerai tetap punya bagian saldonya sendiri, jadi uang gerai A tidak tercampur dengan gerai B di laporan.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Cek Rekening Bersama', teks: 'cek rekening bersama' }, buka('sharedaccounts')]
  },
  {
    id: 'deposit',
    judul: 'Deposit / uang muka',
    kunci: ['deposit', 'uang muka', 'dp', 'titip uang', 'panjar'],
    isi: [
      'Uang muka = uang yang dibayar duluan ke supplier sebelum barangnya datang.',
      'Saldonya disimpan sebagai Deposit, lalu pembelian berikutnya bisa dibayar dari situ.'
    ].join('\n'),
    tawaran: [isi('Catat uang muka', 'uang muka ke Pak Slamet 500rb lewat transfer bank'), buka('hutangpiutang')]
  },
  {
    id: 'bea',
    judul: 'Bea / biaya operasional',
    kunci: ['bea', 'biaya operasional', 'bea gaji', 'bea lapak', 'sewa lapak', 'pengeluaran', 'beban'],
    isi: [
      'Bea = biaya menjalankan gerai: Bea Gaji, Bea Lapak (sewa tempat), dan Bea Lainnya (gas, sampah, dll).',
      'Boleh dicatat walau belum dibayar — jadi hutang dulu, dilunasi belakangan.'
    ].join('\n'),
    tawaran: [isi('Catat biaya', 'beli gas 22rb ke Pak Slamet, bayarnya nanti'), buka('beaops')]
  },
  {
    id: 'hutang',
    judul: 'Hutang & piutang',
    kunci: ['hutang', 'utang', 'piutang', 'kasbon', 'tagihan'],
    isi: [
      'Hutang = yang belum gerai bayar (gaji, sewa, supplier). Piutang = yang belum dibayar ke gerai.',
      'Layar Hutang & Pembayaran merangkum per orang, dan pelunasannya bisa dicatat lewat Una.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Siapa saja yang masih hutang?', teks: 'siapa saja yang masih hutang?' }, buka('hutangpiutang')]
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
    tawaran: [buka('drawers')]
  },
  {
    id: 'persetujuan',
    judul: 'Persetujuan (permit)',
    kunci: ['permit', 'izin', 'persetujuan', 'acc', 'approval', 'void', 'hapus transaksi'],
    isi: [
      'Hal sensitif yang diminta kasir (hapus transaksi, ambil uang kas, tutup laci kasir lain, koreksi presensi) masuk ke Persetujuan dulu.',
      'Pemilik/admin yang menyetujui atau menolak — jadi tidak ada yang hilang diam-diam.'
    ].join('\n'),
    tawaran: [buka('approvals')]
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
    tawaran: [buka('store'), buka('attendance-report')]
  },
  {
    id: 'akun_kasir',
    judul: 'Akun kasir dan karyawan',
    kunci: ['akun kasir', 'buat kasir', 'kasir baru', 'karyawan', 'pin kasir', 'login kasir', 'username kasir'],
    isi: [
      'Akun kasir = login untuk berjualan (username + PIN). Karyawan = data orangnya (nama, HP), dipakai presensi dan gaji; satu karyawan bisa ditautkan ke akun kasirnya.',
      'Akun kasir sengaja tidak dibuat lewat chat: PIN-nya tidak boleh lewat mesin AI. Una bukakan layarnya saja.'
    ].join('\n'),
    tawaran: [buka('cashiers'), buka('employees')]
  },
  {
    id: 'cara_bayar',
    judul: 'Cara bayar',
    kunci: ['cara bayar', 'metode bayar', 'qris', 'transfer', 'tunai', 'payment method'],
    isi: [
      'Cara bayar = tunai, transfer, QRIS, dll., diatur per gerai dan masing-masing tertaut ke akun (Kas, Bank, Rekening Bersama).',
      'Hanya tunai yang menggerakkan uang laci. Aplikasi ini mencatat cara bayarnya — uangnya sendiri tidak diproses aplikasi.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Cara bayar gerai ini apa saja?', teks: 'cara bayar gerai ini apa saja dan akunnya apa?' }]
  },
  {
    id: 'jualan_pertama',
    judul: 'Jualan pertama',
    kunci: ['jualan pertama', 'cara jualan', 'cara jual', 'mulai jualan', 'transaksi pertama', 'kasir jualan'],
    isi: [
      'Kasir login di halaman Kasir (HP atau komputer gerai) dengan akun kasirnya, membuka laci, lalu memilih menu dan menekan bayar.',
      'Begitu ada penjualan, untung-rugi, stok, dan pembukuan jalan sendiri — dan Bos bisa langsung tanya Una "untung hari ini berapa?".'
    ].join('\n'),
    tawaran: [jelas('laci', 'Apa itu laci kasir?')]
  },
  {
    id: 'gerai_entity',
    judul: 'Gerai dan entity',
    kunci: ['entity', 'gerai', 'outlet', 'cabang', 'badan usaha', 'semua gerai'],
    isi: [
      'Gerai = satu toko/outlet. Entity = usahanya (pemilik buku), yang membawahi beberapa gerai.',
      'Data tiap gerai terpisah rapi; laporan entity menjumlahkan semuanya. Di Una, pilih gerai lewat tombol ▾ di atas, atau "semua gerai" untuk tingkat entity.'
    ].join('\n'),
    tawaran: []
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
      'Akun dibuat sendiri di layar Akun Kasir (bukan lewat Una) karena ada password.'
    ].join('\n'),
    tawaran: [buka('employees'), buka('cashiers'), jelas('akun_cs', 'Bikin akun CS + jam kerja')]
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
    tawaran: [buka('cashiers'), jelas('jadwal_beda', 'Jam masuk tiap hari beda?')]
  },
  {
    id: 'jadwal_beda',
    judul: 'Jam masuk CS tiap hari berbeda',
    kunci: ['jam masuk', 'jam masuknya', 'tiap hari beda', 'tidak sama', 'beda beda', 'berbeda', 'ganti shift', 'jadwal berubah'],
    isi: [
      'Bisa. Jadwal di Akun Kasir diisi PER HARI, jadi tiap hari boleh beda jam masuk–pulangnya, dan hari libur dicentang "Libur".',
      'Ubah lewat Tim → Akun Kasir → Edit pada akun CS itu → bagian "Jam & hari kerja" → Simpan kasir.',
      'Telat dinilai dari jadwal hari itu. Hari yang libur atau belum diisi jadwalnya tidak dinilai telat.',
      'Kalau shift-nya beda orang (pagi/sore), lebih rapi bikin akun per shift (mis. "Kasir Shift Pagi"), karena jadwal menempel ke akun, bukan ke orangnya.'
    ].join('\n'),
    tawaran: [buka('cashiers')]
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
    tawaran: [buka('setoran-cs'), { jenis: 'kirim', label: 'Setoran yang masih dibawa?', teks: 'setoran cs yang masih dibawa siapa aja?' }]
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
    tawaran: [buka('cashiers'), buka('employees'), jelas('potongan_gaji', 'Potongan / bonus gaji')]
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
    tawaran: [buka('cashiers')]
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
    tawaran: [buka('cashiers'), buka('attendance-report')]
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
    tawaran: [buka('attendance-report'), buka('permit-report'), buka('cashiers')]
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
    tawaran: [buka('cashiers')]
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
  return { ok: true, dikenal: true, topik: entri.id, judul: entri.judul, jawaban: entri.isi, tawaran: entri.tawaran };
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
    return { ok: true, jawaban: hasil.jawaban, tawaran: hasil.tawaran };
  }
});
