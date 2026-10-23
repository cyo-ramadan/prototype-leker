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
import { cariMenu, jawabanMenu, menuUntuk, normalisasiSkin, PETA_UNA } from './caca-peta.js';
import { peringkatKamus, pilihVarian } from './kerangka/kamus.js';
import { SUMBER_KAMUS } from './caca-kamus-sumber.js';
import TINJAUAN from '../generated/tinjauan-kamus-una.json' with { type: 'json' };

/** Layar yang bisa dibukakan Una. `gerai` = tab di Workspace Gerai. */
export const LAYAR = Object.freeze(Object.fromEntries(
  [...PETA_UNA.filter((p) => p.skin === 'classic' && p.halaman === 'entity'),
   ...PETA_UNA.filter((p) => p.skin === 'classic' && p.halaman === 'gerai')]
    .map((p) => [p.tab, Object.freeze({ label: p.label, halaman: p.halaman })])
));

const buka = (layar) => ({ jenis: 'buka', layar, label: `Buka layar ${LAYAR[layar].label}` });
const isi = (label, teks) => ({ jenis: 'isi', label, teks });
const jelas = (topik, label) => ({ jenis: 'jelaskan', topik, label });

export const KAMUS = Object.freeze([
  {
    id: 'fina_rekrut', judul: 'Rekrutmen: lowongan dan pelamar',
    kunci: ['lowongan', 'loker', 'lowongan kerja', 'pelamar', 'lamaran', 'rekrutmen', 'cari karyawan baru', 'tayangkan lowongan', 'tautan loker', 'form lamaran'],
    isi: [
      'Di Entity Admin → Pengaturan → "Rekrutmen Fina". Isi Posisi, Gerai, Jam kerja, Gaji (teks), Syarat, Deskripsi, lalu "Simpan sebagai draft". Fina juga bisa menyusun draft lowongan dari chat.',
      'Draft belum terlihat umum. Tekan "Tayangkan" supaya halaman /loker?l=… bisa dibuka; "Salin tautan" untuk dibagikan ke WA, Facebook, atau Instagram (posting manual). "Tutup lowongan" menghentikan lamaran baru; "Jadikan draft" untuk menyunting ulang.',
      'Pelamar mengisi nama, nomor WhatsApp, domisili, umur, dan pengalaman, lalu menekan "Kirim lamaran". Satu nomor hanya bisa melamar sekali sehari per lowongan.',
      'Buka lowongan untuk melihat pelamar: tombol WA untuk menghubungi, catatan admin, dan status Baru / Screening / Interview / Diterima / Ditolak. Keputusan Diterima / Ditolak hanya oleh Admin; Fina tidak membaca nomor pelamar.',
      'Semua pelamar (dari lowongan maupun yang datang lewat WA, Instagram, atau langsung) ada di menu Karyawan → tombol "Pelamar" (bawaannya terbuka "Karyawan"). Di situ isi Nama, Nomor WhatsApp, Posisi yang dilamar, Gerai tujuan, Domisili, Umur, Sumber, Pengalaman, lalu "Simpan pelamar"; satu nomor WA hanya dicatat sekali. Daftar bisa disaring per status dan gerai.'
    ].join('\n'),
    tawaran: [], tanpaAksi: 'lowongan ditayangkan dan pelamar diputuskan lewat tombol di Rekrutmen Fina'
  },
  {
    id: 'fina_wa', judul: 'Kotak masuk WA Fina, undangan interview/training, kabar ke CS',
    kunci: ['kotak masuk wa', 'pesan wa fina', 'antrean kirim', 'wa pelamar', 'undang interview', 'undang training', 'kabari cs', 'janjian training', 'catat pelamar dari wa', 'pesan wa belum terkirim'],
    isi: [
      'Pesan WA yang masuk ke nomor HR (lewat gateway di laptop) tampil di Entity Admin → Pengaturan → "Kotak masuk WA Fina", ditandai Pelamar / Karyawan / Belum dikenal. Tombol "Tandai dibaca" dan "Muat ulang".',
      'Di chat, pilih Fina lalu minta misalnya: "catat pelamar dari WA" (pengirim belum dikenal masuk ke Karyawan → Pelamar), "undang Sari interview di Beji besok jam 10" (WA undangan ke pelamar), atau "kabari Avinda besok jam 14 ada training Sari" (WA ke CS gerai). Semua lewat draft dan tombol "Ya".',
      'Sesudah "Ya", pesan masuk "Antrean kirim" dengan status Menunggu gateway, lalu Terkirim atau Gagal. Pesan berstatus Draft perlu tombol "Setujui"; "Batal" membatalkan. Pesan hanya terkirim kalau laptop gateway menyala, dan ada batas kirim per jam serta per nomor supaya nomor tidak diblokir.',
      'Nomor HP tidak pernah dibaca model; isi pesan orang yang belum dikenal juga tidak.'
    ].join('\n'),
    tawaran: [], tanpaAksi: 'pesan WA dikirim lewat draft Fina atau tombol Setujui di Kotak masuk WA'
  },
  {
    id: 'fina_kanal', judul: 'Sambungan Fina: WA, email, Instagram, Facebook',
    kunci: ['sambungan fina', 'hubungkan wa', 'sambungkan wa', 'gateway wa', 'token gateway', 'hubungkan email', 'hubungkan instagram', 'hubungkan facebook', 'konek wa ke fina'],
    isi: [
      'Di Entity Admin → Pengaturan → "Sambungan Fina": WhatsApp, Email, Instagram, Facebook usaha ini. Centang "Hubungkan ke Fina", isi akun/nomor, lalu "Simpan …".',
      'WhatsApp memakai gateway di laptop/PC (perangkat tertaut, jalur tidak resmi): tekan "Buat token gateway", lalu "Salin token" dan tempel di gateway WA. Token hanya tampil sekali; "Ganti token gateway" membuat token lama tidak berlaku. Laptop harus menyala, dan risiko nomor diblokir WhatsApp tetap ada.',
      'Email disimpan dulu (penerusan email masuk disiapkan tahap berikutnya). Instagram dan Facebook dicatat akunnya; otomatisasi belum bisa karena akun Meta dibatasi, jadi Fina menyiapkan teks untuk diposting manual.',
      'Fina hanya menyiapkan: setiap pesan keluar menunggu persetujuan Admin.'
    ].join('\n'),
    tawaran: [], tanpaAksi: 'sambungan diatur Admin di kartu Sambungan Fina'
  },
  {
    id: 'fina_tulis', judul: 'Fina: tawaran backup, catat pengganti, pengumuman, draft SP', agen: ['fina'],
    kunci: ['tawaran backup', 'tawarin backup', 'siapin tawaran', 'catat pengganti', 'menggantikan', 'gantiin', 'pasang pengumuman', 'umumkan', 'pengumuman cs', 'buat sp', 'surat peringatan', 'teguran', 'fina bisa apa'],
    isi: [
      'Pilih Fina di tab chat. Fina bisa: (1) menyiapkan teks tawaran backup untuk freelance yang tersedia di jam tertentu (jumlahnya sesuai pengaturan Fina, teks disalin dan dikirim manual, tidak ada yang terkirim otomatis);',
      '(2) mencatat "X menggantikan Y" untuk CS yang presensi di gerai itu, lewat koreksi pengganti Dana Apresiasi yang sama, sehingga shift dinilai ulang;',
      '(3) memasang pengumuman di papan CS (Portal Staf) untuk gerai itu atau semua gerai;',
      '(4) menyusun draft SP/teguran dari rekap masalah CS (telat, pulang awal, kosong, denda, lupa presensi pulang) dengan kop dan tingkat dari pengaturan Fina;',
      '(5) menyusun draft lowongan kerja (teks loker + caption Instagram/Facebook untuk diposting manual), tersimpan DRAFT sampai Admin menekan Tayangkan di Rekrutmen Fina;',
      '(6) urusan WA lewat gateway: catat pelamar dari WA, undang pelamar interview/training di gerai tertentu, dan kabari CS gerai untuk mendampingi training (lihat Kotak masuk WA Fina).',
      'Semua kecuali tawaran backup lewat kartu draft dan tombol "Ya". Draft SP hanya tersimpan sebagai DRAFT; berlaku setelah Admin menekan Setujui di Entity Admin → Pengaturan → Surat Fina.'
    ].join('\n'),
    tawaran: [jelas('fina_surat', 'Surat Fina (SP)'), jelas('fina_pengaturan', 'Pengaturan Fina (HR)')], tanpaAksi: 'alat tulis Fina dipakai dari chat dengan memilih Fina'
  },
  {
    id: 'fina_surat', judul: 'Surat Fina (teguran / SP)', agen: ['fina'],
    kunci: ['surat fina', 'surat sp', 'setujui sp', 'batalkan sp', 'draft sp', 'daftar sp', 'masa berlaku sp', 'surat teguran'],
    isi: 'Di Entity Admin → Pengaturan → "Surat Fina (teguran / SP)". Daftar bisa disaring Draft / Disetujui / Dibatalkan. Buka satu surat untuk melihat fakta (telat, pulang awal, kosong, denda, lupa pulang, jumlah shift) dan isinya. Tombol: "Salin isi", "Setujui" (hanya untuk draft; mulai berlaku hari itu sampai masa berlaku di pengaturan Fina), dan "Batalkan" (wajib alasan). Hanya Entity Admin atau Owner yang bisa menyetujui; Fina tidak bisa. Surat belum dikirim ke CS; kirim manual sampai fitur WA Fina ada.',
    tawaran: [], tanpaAksi: 'menyetujui atau membatalkan surat hanya lewat tombol di Entity Admin'
  },
  {
    id: 'fina_baca', judul: 'Fina: gerai kosong, freelance dan rekap masalah CS', agen: ['fina'], tawaran: [],
    kunci: ['gerai kosong', 'shift kosong', 'freelance tersedia', 'backup siapa', 'rekap masalah cs', 'fina presensi'],
    isi: 'Fina membandingkan shift yang sedang berjalan dengan presensi dan pengganti yang tercatat, termasuk shift lewat tengah malam. Batas menit dan izin lintas gerai mengikuti kartu Fina (HR) di Entity Admin → Pengaturan; selama belum diubah, dipakai bawaan aplikasi (kosong setelah 10 menit, boleh backup lintas gerai). Aktivasi backup saja bukan bukti hadir. Daftar freelance membuang yang berbenturan jadwal, presensi atau aktivasi gerai lain, mengurutkan gerai sama lebih dahulu, dan tetap perlu konfirmasi kesediaan orangnya serta aktivasi admin. Admin Gerai hanya melihat kandidat gerainya. Rekap masalah CS menampilkan telat, pulang awal, kosong, denda tercatat dan lupa presensi pulang; satu shift bisa mempunyai beberapa jenis masalah tetapi dihitung satu kejadian. Kosong/denda memakai evaluasi tersimpan; jam sesi tanpa evaluasi memakai jadwal saat ini. Membaca tidak menilai ulang, memotong gaji, mengirim pesan atau memberi SP. Keputusan tetap di admin.',
    tanpaAksi: 'Alat baca Fina; aktivasi backup, uang dan keputusan HR tetap lewat admin.'
  },
  {
    id: 'una_laporan_chat', judul: 'Menyuruh Una membuka dan mengatur Laporan', tawaran: [],
    kunci: ['una buka laporan','ganti tanggal laporan','ganti range tanggal','ubah periode laporan','atur tanggal laporan','laporan lewat chat','koreksi tanggal laporan','minggu sebelumnya'],
    isi: 'Di Entity Admin, Bos bisa mengetik atau mengucapkan misalnya "buka laporan tanggal 1 sampai 10 Oktober". Di halaman Entity Admin chat bawaannya membahas Entity; kalau Bos memindahkannya ke satu gerai, Una meminta memilih "Entity" lagi di daftar gerai atas chat. Una membuka Laporan Usaha di Workspace lalu mengisi tanggalnya dan memuat data lewat tombol laporan yang sama. Koreksi seperti "eh sampai tanggal 8 aja", "mulai tanggal 3" atau "kalau minggu sebelumnya?" memakai tanggal yang sedang tampil, termasuk yang Bos ubah sendiri, dan menggantikan muatan yang belum selesai sehingga hasil lama tidak muncul. Tahun mengikuti laporan yang tampil, kalau belum ada memakai tahun ini. Tanggal yang tidak ada atau terbalik ditanyakan dulu. Una baru bilang laporan sudah tampil setelah datanya benar-benar termuat. Kalau Bos sudah mengganti tanggal di layar sebelum perintah dijalankan, Una tidak menimpanya dan meminta Bos memeriksa dulu. Ketik "stop" untuk berhenti menunggu; draft dan persetujuan tidak tersentuh. Tahap ini baru Laporan Usaha Entity; menu lain dibuka biasa.',
    tanpaAksi: 'Mengatur tampilan laporan, bukan transaksi; dikerjakan langsung lewat perintah chat.'
  },
  {
    id: 'una_lembar', judul: 'Lembar Workspace dan gambar', tawaran: [],
    kunci: ['lembar workspace','lembar gambar','kanvas','cara pakai kanvas','cara memakai kanvas','coretan','gambar tersimpan','konflik lembar','una baca gambar','una lihat coretan','baca coretan'],
    isi: 'Di Workspace, tombol "Tugas" menampilkan draft yang tetap memerlukan pemeriksaan dan persetujuan manual. "Lembar gambar baru" membuka tempat mencoret dengan pena, teks dan bentuk, undo/redo, zoom serta "Ekspor PNG". Lembar tersimpan per akun dan lingkup yang dipilih. Menutup tampilan tidak menghapus lembar atau membatalkan tugas. Jika status "Belum tersimpan", edit tetap di layar; coba "Simpan sekarang" atau ekspor gambar. Saat ada versi baru, pilih "Muat versi server" atau, untuk kanvas, "Simpan sebagai lembar baru". Halaman yang sama tetap satu lembar; konflik filter dapat diekspor sebelum memuat versi server. Angka laporan dimuat ulang lewat aplikasi dan tidak disimpan dalam lembar. Saat lembar gambar terbuka, katakan misalnya "lihat gambar ini" atau "ini maksudnya apa?": coretan yang belum tersimpan disimpan dulu, lalu Una menjelaskan yang terlihat, dugaan maksudnya, dan bagian yang belum jelas. Kalau Bos mencoret lagi sebelum jawabannya datang, Una menandainya sebagai bacaan versi sebelumnya. Usulan catatan Una baru masuk ke gambar bila Bos menekan tombolnya dan bisa dibatalkan dengan Undo. Usulan pekerjaan toko hanya ditaruh di kotak ketik; menyimpannya tetap lewat draft dan persetujuan.',
    tanpaAksi: 'Lembar bukan transaksi bisnis; gunakan kontrol Workspace atau minta Una membaca lembar yang terbuka.'
  },
  {
    id: 'hapus_arus_kas', judul: 'Hapus Arus Kas yang salah catat',
    kunci: ['hapus arus kas', 'batal arus kas', 'arus kas salah', 'salah arus kas', 'hapus kas masuk', 'hapus kas keluar'],
    isi: 'Arus Kas yang sudah ACC bisa dihapus tanpa menghilangkan riwayatnya. CS: di Kasir buka Data, cari baris Arus Kas, tekan Hapus, isi alasan; pengajuannya masuk Izin CS untuk ACC atau Tolak Admin, dan sebelum diputuskan CS bisa Batal Hapus. Admin Gerai: di Transaksi tekan 🗑 Hapus pada baris Arus Kas dan isi alasan, langsung diproses. Sesudah dihapus, Arus Kas itu tidak dihitung lagi di uang laci, statusnya "Dihapus (read only)", dan jurnalnya dibalik di tanggal aslinya. Una tidak menekan ACC atau Hapus untuk Bos.',
    tawaran: [buka('approvals')], tanpaAksi: 'penghapusan lewat izin CS atau Admin di layar Transaksi'
  },
  {
    id: 'batal_penjualan', judul: 'Hapus / batalkan penjualan',
    kunci: ['batal penjualan', 'batalkan penjualan', 'hapus penjualan', 'hapus transaksi', 'pembatalan transaksi', 'void transaksi'],
    isi: 'Di Kasir, buka Data, cari penjualan lalu tekan Hapus dan isi alasan. Pengajuan masuk Persetujuan untuk ACC atau Tolak Admin. Sebelum diputuskan, kasir bisa Batal Hapus. Riwayat tetap ada; saat berhasil, stok/kas dikoreksi dan jurnal yang sudah posted dibalik, bukan dihapus. Untuk pembelian bahan, sesudah tekan Hapus kasir memilih "Ganti dengan pembelian yang benar" (barang sama; isi qty yang didapat, total di nota, dan cara bayar yang benar) atau "Hapus pembelian ini". Kalau stok bahannya sudah terpakai, Hapus saja tidak bisa dan kasir wajib mengisi pembelian yang benar. ACC belum selalu berarti selesai: bila tertahan (HOLD/FAILED), alasannya tampil di Data kasir sebagai "ACC tertahan" dan di Izin CS bagian ACC tertahan; Admin dapat menekan Coba lagi sesudah penyebabnya dibereskan. Una tidak menekan ACC untuk Bos.',
    varian: { h: { isi: 'Di Kasir, buka Data, cari transaksi lalu Hapus dan isi alasan. Pada skin H, bila Auto Permit gerai aktif, transaksi langsung diproses; jika tidak, menunggu ACC Admin di Persetujuan. Riwayat tetap ada. Periksa status eksekusi: HOLD/FAILED perlu ditinjau, bukan dianggap berhasil. Jurnal posted diperbaiki dengan pembalik.' } },
    tawaran: [buka('approvals')], tanpaAksi: 'pembatalan lewat permit dan pemeriksaan Admin'
  },
  {
    id: 'tutup_laci', judul: 'Menutup laci dan uang setoran',
    kunci: ['cara tutup laci', 'menutup laci', 'tutup laci', 'akhir shift', 'saldo akhir laci'],
    isi: 'Di Kasir tekan Tutup Laci. Isi kas fisik akhir dan uang yang ditinggal di laci, lalu ambil foto langsung sesuai layar. Selisih uang akhir dan yang ditinggal menjadi setoran yang dibawa CS; piutangnya tidak otomatis lunas. Kirim bukti transfer lewat Portal Staf, lalu Admin mencocokkan dan ACC. Saldo awal laci berikutnya melanjutkan kas akhir dikurangi setoran. Menutup laci kasir lain memakai pengajuan izin; Una tidak menutup atau memindahkan uang laci.',
    tawaran: [buka('drawers'), jelas('setoran_cs', 'Cara setoran CS')], tanpaAksi: 'kas fisik diperiksa kasir pada layar Tutup Laci'
  },
  {
    id: 'tugas_buka_laci', judul: 'Tugas Buka Laci (stok opname, uang laci, aset)',
    kunci: ['tugas buka laci', 'stok opname', 'stock opname', 'opname buka laci', 'hitung uang laci', 'cek aset', 'apron', 'aset laci', 'transaksi ditahan'],
    isi: 'Bila saklar Tugas Buka Laci aktif di kebijakan tenant, sesudah CS membuka laci langsung muncul tiga langkah wajib: 1) Stok opname -- semua Bahan dan Bahan Setengah Jadi sudah terdaftar, CS tinggal mengisi qty nyata hasil hitung; sebelum disimpan, bahan yang berselisih ditampilkan untuk dicek ulang, lalu selisihnya langsung jadi Penyesuaian Stok. 2) Hitung uang laci -- CS mengisi uang fisik di laci; saldo awal tetap dari sistem, selisihnya dicatat di laporan laci dan admin dikabari, tanpa jurnal otomatis. 3) Cek aset -- tiap aset dipilih Ada/Tidak ada (daftar diatur Admin Gerai di tab Daily Task jenis "Aset cek buka laci", isi awal Apron); aset yang tidak ada tetap boleh lanjut, admin dikabari. Sebelum ketiganya selesai, jualan/belanja/biaya di laci itu ditolak; tutup laci tetap bisa. Statusnya juga tampil di Daily Task Portal Staf. Una tidak mengisi hitungan untuk CS.',
    tawaran: [jelas('laci', 'Apa itu laci kasir?')], tanpaAksi: 'hitungan fisik stok, uang, dan aset diisi CS sendiri di layar kasir'
  },
  {
    id: 'retur_barang', judul: 'Retur barang',
    kunci: ['retur', 'retur barang', 'barang dikembalikan', 'pengembalian barang', 'refund'],
    isi: 'Belum ada alur khusus Retur yang sekaligus mengembalikan uang dan stok. Jangan mencatat uang kembali dengan menebak. Salah transaksi penuh: periksa pembatalan lewat Hapus dan ACC Admin. Barang rusak atau selisih fisik: periksa Arus Barang atau Penyesuaian Stok. Pengembalian sebagian dan pembayaran kembali perlu diperiksa Admin/akuntan sesuai kejadian.',
    tawaran: [jelas('batal_penjualan', 'Pembatalan transaksi'), jelas('barang_rusak', 'Barang rusak')], tanpaAksi: 'belum ada alat retur parsial; jangan mengarang transaksi uang'
  },
  {
    id: 'suara_una', judul: 'Suara dan obrolan Una',
    kunci: ['suara una', 'una bicara', 'mikrofon', 'mode suara', 'suara pemilik', 'kenali suara', 'dengarkan', 'obrolan live', 'mulai live', 'percakapan live', 'mengakhiri live'],
    isi: 'Mikrofon mengubah ucapan menjadi pesan. Saklar Una bicara membacakan balasan dengan suara Indonesia bila browser menyediakannya; tiap balasan juga bisa didengarkan. Hentikan ucapan dengan tombol berhenti. Profil suara pemilik, bila dipilih, disimpan di perangkat ini dan bersifat percobaan; bukan pengganti login atau bukti identitas. Atur pilihan headset dan profil pemilik pada Pengaturan → Asisten. Mulai atau akhiri obrolan live dari tombol telepon di chat: transkrip diproses lokal, unduhan awal sekitar 41 MB. Pengenalan pemilik opsional dan membutuhkan unduhan terpisah sekitar 102 MB serta tiga contoh suara. Tanpa opsi pemilik, live tetap berjalan. Ucapan bisa disela sementara tugas tetap berjalan; perintah baru mengantre. Gunakan headset bila browser tidak mendukung peredam gema penuh. Kecepatan dan ketepatan bergantung perangkat; model AI tugas tetap memakai layanan yang sudah dikonfigurasi. Suara tidak pernah menekan Ya: periksa dan setujui draft dari Workspace.',
    tawaran: [], tanpaAksi: 'pengaturan suara dan mikrofon dikerjakan di panel perangkat'
  },
  {
    id: 'nama_una', judul: 'Mengganti nama asisten',
    kunci: ['nama una', 'ganti nama asisten', 'nama asisten', 'panggilan asisten'],
    isi: 'Nama panggilan asisten dapat diatur pada halaman Pengaturan, bagian Asisten, oleh akun yang berhak: "Simpan nama untuk tenant" untuk Una, dan "Simpan Rika & Fina untuk tenant" untuk nama asisten akuntan dan HR. Nama berlaku untuk tenant yang sama. Mengganti nama tidak mengubah hak akses atau cara persetujuan pekerjaan.',
    tawaran: [jelas('pilih_asisten', 'Memilih Una, Rika, atau Fina')], tanpaAksi: 'pengaturan nama memakai formulir pengaturan'
  },
  {
    id: 'pilih_asisten', judul: 'Memilih Una, Rika, atau Fina',
    kunci: ['rika', 'fina', 'pilih asisten', 'ganti asisten', 'asisten akuntan', 'asisten hr', 'agen akuntan', 'agen hr', 'una rika fina', 'matikan fina', 'matikan rika'],
    isi: 'Di bawah judul panel chat ada tab kecil untuk memilih lawan bicara. Una = asisten toko dengan semua kemampuan lama. Rika = asisten akuntan: HPP, jurnal, aturan jurnal, sinkron akuntansi, rentang harga beli, cara bayar, pindah saldo, dan membaca data untuk menelusuri angka yang janggal. Fina = asisten HR: jadwal kasir, tambah karyawan, cek gerai kosong, freelance yang bisa backup, rekap masalah CS, teks tawaran backup, catat pengganti, pengumuman CS, draft SP, draft lowongan, catat pelamar dari WA, undang pelamar lewat WA, dan kabari CS untuk training. Tiap asisten punya percakapan sendiri, jadi riwayat dan draft tidak tercampur, dan pilihan terakhir diingat per halaman. Rika dan Fina bawaannya aktif; nama dan saklarnya diatur di Pengaturan → Asisten lewat "Simpan Rika & Fina untuk tenant". Asisten yang dimatikan tidak muncul di tab dan ditolak server. Semua yang menyimpan data tetap lewat draft dan tombol "Ya".',
    tawaran: [], tanpaAksi: 'memilih asisten memakai tab di kepala panel chat'
  },
  {
    id: 'mode_analisis', judul: 'Mode Analisis (Claude Sonnet)',
    kunci: ['mode analisis', 'tombol analisis', 'sonnet', 'claude', 'model pintar', 'ganti model', 'tombol mikroskop', 'analisis mendalam'],
    isi: 'Chat biasa memakai model murah. Untuk kasus yang butuh analisis, tekan tombol 🔬 di sebelah tombol Kirim lalu kirim pesannya: pesan itu (beserta langkah-langkah lanjutannya) dikerjakan Claude Sonnet 5.5, lebih teliti tetapi biaya per pesan jauh lebih mahal. Tombolnya mati sendiri sesudah satu pesan. Tombol 🔬 hanya muncul kalau Owner menyalakan "Model analisis: Claude Sonnet" untuk tenant ini di Owner Console dan kunci Claude sudah terpasang di server. Aturannya tetap sama: angka hanya dari data, dan yang menyimpan data tetap lewat draft dan tombol "Ya".',
    tawaran: [], tanpaAksi: 'mode analisis dipilih dengan tombol 🔬 di panel chat'
  },
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
      '• Hitung ulang HPP bahan dari pembelian yang dibatalkan/diganti nominal (hanya jam 23.00–07.00; sistem juga mengerjakannya sendiri tiap malam).',
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
      'Kalau HPP kelihatan aneh, biasanya harga beli bahan salah ketik — betulkan lewat Hitung Ulang HPP.',
      'Pembelian yang dibatalkan/diganti nominal sesudah bahannya terpakai: HPP bahannya diputar ulang otomatis tiap malam jam 23.00–07.00 (Putar Ulang HPP), atau minta Una di jam itu. Kalau riwayatnya tidak cocok, status izinnya "tertahan" dan perlu dicek manual.'
    ].join('\n'),
    tawaran: [jelas('resep', 'Apa itu resep?'), { jenis: 'kirim', label: 'Barang yang HPP-nya di atas harga jual', teks: 'barang mana yang HPP-nya di atas harga jual?' }],
    tanpaAksi: 'penjelasan istilah; koreksi HPP lewat hitung_ulang_hpp saat Bos menyebut bahannya'
  },
  {
    id: 'resep',
    varian: { f: { isi: 'Di Racik Parfum, buka Barang ? Bahan & Aroma. Tambah bahan dan pilih satuan serta harga modalnya, lalu tambah aroma, harga jual dan resep standar dari takaran bahan. Saat Edit aroma, Simpan aroma memperbarui resep standarnya. Kasir meracik pesanan dengan takaran yang dipilih dan HPP mengikuti bahan yang dipakai.' } },
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
      'Omzet = total penjualan. Di laporan gerai, Untung Kotor = penjualan + pendapatan lain − HPP; Untung Bersih mengurangi beban (gaji, sewa lapak, dll.) lalu memperhitungkan untung/rugi penyesuaian stok.',
      'Semuanya terhitung sendiri dari penjualan, pembelian, dan biaya yang dicatat — tidak perlu rekap manual.'
    ].join('\n'),
    tawaran: [{ jenis: 'kirim', label: 'Untung hari ini?', teks: 'untung hari ini berapa?' }, buka('labarugi')],
    tanpaAksi: 'angkanya ditanyakan langsung ("untung hari ini berapa?") — alat bacanya bukan alat tulis'
  },
  {
    id: 'jurnal_split', judul: 'Jurnal Split harian',
    kunci: ['jurnal split', 'split jurnal', 'bagi jurnal per hari', 'jurnal dibagi harian'],
    isi: 'Di layar Akuntansi pilih Jurnal Split. Isi Keterangan, akun Debit dan Kredit yang aktif dan berbeda, total rupiah serta tanggal awal dan akhir. Untuk akun hutang atau piutang per orang, isi atas nama yang diminta; nama yang mirip nama lama ditanya "Maksudnya ...?" dan nama baru dikonfirmasi dulu supaya satu orang tidak terpecah dua nama. Periksa pratinjau lalu tekan Buat Jurnal Split dan konfirmasi. Total dibagi rata per hari; sisa pembulatan masuk hari terakhir. Tanggal yang sudah tiba diproses saat dibuat, tanggal berikutnya menunggu proses jadwal saat jatuh tempo; kegagalan posting ditampilkan. Ini entry baru, tidak memerlukan jurnal sumber. Di bawah formulir ada daftar Jurnal Split yang sudah dibuat: Posting sekarang memposting semua hari yang belum diposting termasuk tanggal yang belum tiba (tanggal transaksinya tetap tanggal hari itu); Hapus split membatalkan seluruh split sekaligus, hari yang belum diposting dilewati dan hari yang sudah diposting dibalik dengan jurnal pembalik bertanggal sama. Split lama juga bisa dihapus. Una dapat menjelaskan dan membuka layar; pembuatan split dilakukan melalui formulir Akuntansi.',
    tawaran: [buka('accountingWorkspaceTab')], tanpaAksi: 'belum ada alat Una untuk membuat jadwal split; gunakan formulir Akuntansi'
  },
  {
    id: 'jurnal',
    judul: 'Jurnal',
    kunci: ['jurnal', 'debit', 'kredit', 'posting', 'pembukuan', 'akuntansi'],
    isi: [
      'Jurnal = catatan pembukuan. Hampir semuanya dibuat OTOMATIS dari penjualan, pembelian, dan biaya — pemilik tidak perlu menulisnya.',
      'Jurnal manual cuma untuk hal di luar itu (mis. setoran modal). Debit dan kredit wajib sama persis.',
      'Jurnal yang sudah diposting tidak bisa diedit; kalau salah, dibetulkan dengan jurnal balik — jadi jejaknya rapi.',
      'Jurnal balik memakai tanggal transaksi aslinya, bukan tanggal dibatalkan. Siapa yang membuat jurnal dan jam entry-nya terlihat di Detail jurnal.'
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
      'Boleh dicatat walau belum dibayar — jadi hutang dulu, dilunasi belakangan.',
      'Nama pihak yang ditulis bebas dicocokkan dengan nama yang sudah ada: tulisan yang sama memakai nama lama, yang mirip ditanya "Maksudnya ...?", nama baru dikonfirmasi dulu.'
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
    varian: {
      e: { isi: 'Laci mencatat uang tunai. Skin E untuk pemilik yang jaga sendiri: membuka laci tidak perlu presensi. Saldo awal melanjutkan kas akhir sebelumnya dikurangi setoran; laci pertama diisi sesuai kas fisik. Una tidak memindahkan uang laci.' },
      f: { isi: 'Laci mencatat uang tunai. Di Racik Parfum (skin F), kasir/pemilik dapat membuka laci tanpa presensi; pengajuan izin lainnya tetap diperiksa menurut kebijakannya. Saldo awal melanjutkan kas akhir sebelumnya dikurangi setoran. Una tidak memindahkan uang laci.' }
    },
    judul: 'Laci kasir',
    kunci: ['laci', 'drawer', 'buka laci', 'tutup laci', 'selisih', 'uang laci', 'kas laci'],
    isi: [
      'Laci = uang tunai di gerai. Kasir membuka laci di awal shift dan menutupnya di akhir; saldo awal melanjutkan kas akhir sebelumnya dikurangi setoran (laci pertama diisi manual).',
      'Bila saklar Tugas Buka Laci aktif, sesudah laci dibuka CS wajib stok opname, hitung uang laci, dan cek aset dulu; sebelum selesai laci belum bisa dipakai jualan/belanja.',
      'Yang menggerakkan laci hanya pembayaran tunai — termasuk bagian tunai dari pembayaran campuran (tampil sebagai baris "Bagian tunai pembayaran campuran" di Penjualan Bayar Tunai). Selisih saat tutup langsung kelihatan di laporan laci.',
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
      'Pemilik/admin yang menyetujui atau menolak — jadi tidak ada yang hilang diam-diam.',
      'Izin yang sudah di-ACC tapi tertahan (mis. stok kurang untuk membatalkan pembelian) tampil di bagian "ACC tertahan" dengan alasannya dan tombol Coba lagi.'
    ].join('\n'),
    tawaran: [buka('approvals')],
    tanpaAksi: 'ACC/tolak diputuskan Admin di layar Persetujuan, bukan lewat chat'
  },
  {
    id: 'presensi',
    varian: { e: { isi: 'Skin E dipakai pemilik yang jaga sendiri; presensi tidak diwajibkan untuk membuka laci. Bila usahanya memakai karyawan, pilih skin yang sesuai agar presensi dan pemeriksaan izinnya berlaku.' } },
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
    kunci: ['cara bayar', 'metode bayar', 'qris', 'transfer', 'tunai', 'payment method', 'bayar campuran', 'pembayaran campuran', 'campuran', 'split bill', 'sebagian qris', 'sebagian tunai', 'bayar dua cara'],
    isi: [
      'Cara bayar = tunai, transfer, QRIS, dll., diatur per gerai. POS memakai pilihan cara bayar aktif; jika memakai Accounting, pemetaan akun (Kas, Bank, Rekening Bersama) diurus terpisah oleh pembukuan.',
      'Cara bayar QRIS dibukukan sama dengan Rekening Bersama (akun 1103), karena uang QRIS dipindah ke rekening bersama dalam sehari.',
      'Rekening Bersama (REKBER) tidak dipakai untuk penjualan (sejak 18 Okt 2026): tidak muncul di pilihan cara bayar penjualan dan ditolak bila dikirim; untuk pembelian/pengeluaran tetap bisa. Pembeli yang scan QRIS dicatat dengan cara bayar QRIS.',
      'Pembayaran campuran (saklar "Pembayaran campuran", bawaan aktif): di dialog penjualan pilih Cara bayar "🔀 Campuran", isi nominal bagian pertama (mis. QRIS 5.000), bagian kedua (mis. Tunai) terisi otomatis dari sisa total. Jurnal mendebit akun tiap cara bayar sesuai bagiannya; uang laci hanya bertambah bagian tunainya; QRIS ditautkan sebesar bagian QRIS-nya. Cara bayar hutang tidak bisa dicampur.',
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
      'Supplier yang aktif muncul di pilihan "Supplier" saat kasir mencatat Beli Bahan, jadi hutang dan uang muka ke supplier itu terlacak per nama.',
      'Saat membuat jurnal Utang Usaha atas nama pemasok yang belum terdaftar, layar menawarkan "Tambahkan sebagai pemasok baru?" dan pemasok itu langsung masuk daftar Supplier.'
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
      '• Pilih Barang, isi "🧾 Total di nota (Rp)" untuk barang itu, lalu "Qty yang didapat" → "＋ Masukkan". Ulangi untuk barang lain. Harga per satuan hanya lewat tombol ⇄ (dikali qty lalu dibulatkan, jadi bisa meleset dari nota).',
      '• SIMPAN PEMBELIAN, cocokkan ringkasan yang muncul dengan nota, lalu OK. Stok langsung bertambah dan modal rata-rata (HPP) diperbarui.',
      '• Salah nominal, qty, atau cara bayar? Di Data → Hapus → "Ganti dengan pembelian yang benar": isi qty yang didapat, total di nota, dan cara bayar yang benar, satu kali ACC. Uang laci, stok, dan jurnal langsung dibetulkan; HPP bahannya dihitung ulang otomatis malam itu. Kalau bahannya sudah terpakai, pilihan Hapus saja tidak tersedia.',
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
      '• Di Beli Bahan, isi Total di nota sesuai tagihan untuk barang yang datang itu dan Qty yang didapat sesuai yang datang. Tulis selisihnya di Catatan (mis. "nota 10, datang 8").',
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
    kunci: ['rusak', 'barang rusak', 'rusak saat diterima', 'cacat', 'pecah', 'basi', 'kedaluwarsa', 'expired', 'busuk', 'tumpah'],
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
      'Isi Nama lengkap (mis. Rika Nur), No. HP, No. identitas, alamat, tahun kelahiran, alamat domisili saat ini, dan foto kalau ada, lalu Simpan karyawan.',
      'Alamat domisili dicatat bersama tanggal entry-nya; kalau nanti pindah, isi alamat baru — alamat lama tetap tersimpan di riwayat.',
      'Dari Entity Admin → Karyawan juga bisa: tekan "＋ Tambah karyawan" di atas daftar, pilih gerai perekrut (atau Level Entity), isi datanya.',
      'Di Entity Admin → Karyawan, tombol "Detail" di tiap kartu menampilkan foto, tahun kelahiran, domisili (dengan tanggal dicatat dan riwayatnya), dan akun yang tertaut; data diri itu juga bisa diperbarui dari sana.',
      'Supaya dia bisa login dan presensi, buatkan juga akunnya di Tim → Akun Kasir, lalu kembali ke Karyawan dan tekan "Tautkan" ke username itu.',
      'Atau suruh Una: karyawan, akun login, dan tautannya dibuat sekaligus. Password akun dibuat sistem dan ditampilkan sekali — tidak pernah lewat mesin AI.'
    ].join('\n'),
    tawaran: [buka('employees'), buka('cashiers'), jelas('akun_cs', 'Bikin akun CS + jam kerja')],
    aksi: { alat: 'buat_karyawan', tawar: 'Mau Una yang buatkan? Bilang "buatin", atau langsung sebut namanya, mis. "tambah karyawan Rika Nur hp 0812…" — sekalian akun login kalau perlu.', tombol: 'Una buatkan karyawan' }
  },
  // Info Gerai (Bos Cyo, 2026-10-16): src/info-gerai.js, public/info-gerai.js.
  {
    id: 'info_gerai',
    judul: 'Info Gerai: kontak darurat, laporan masalah, panduan',
    kunci: ['info gerai', 'kontak darurat', 'supplier es batu', 'pemasok es batu', 'es batu habis', 'nomor supplier', 'lapor masalah', 'laporkan masalah', 'lampu mati', 'neon box', 'listrik mati', 'temuan sidak', 'sidak', 'panduan masalah', 'cara mengatasi', 'dokumentasi masalah'],
    isi: [
      'Tombol "ℹ️ Info Gerai" ada di kasir (deretan tombol laci) dan di Entity Admin (tiap kartu gerai, angka merah = laporan yang belum beres; 🔴 = mengganggu jualan).',
      'CS dapat mengisi nama kontak pemasok darurat, nomor WhatsApp, dan alamat lewat Laporan Masalah. Jumlah laporan yang dikirim CS tercatat pada Raport/KPI sebagai bahan penilaian.',
      'Isinya tiga bagian:',
      '• 📞 Kontak Darurat — pemasok/tukang per kategori (Es Batu, Plastik, Gas, Tukang Listrik…), dengan tombol Chat WA, Telepon, dan Buka Peta. Urutannya Utama lalu Cadangan 1, 2. Kalau nomornya salah atau tokonya tutup, tekan "⚠️ Nomor salah / tutup".',
      '• ⚠️ Laporan — tekan "＋ Laporkan Masalah", pilih kategori, tulis masalahnya, pilih seberapa mendesak (🔴 langsung jadi notifikasi ke admin), boleh tambah foto. CS lain bisa menekan "👀 Saya juga lihat" atau menambah catatan. Admin mengubah statusnya: Sudah dilihat → Sedang ditangani → ✅ Tandai selesai.',
      '• 📘 Panduan & Solusi — "masalah → cara mengatasi". Saat laporan ditandai selesai, solusinya wajib ditulis dan otomatis tersimpan jadi panduan, jadi CS baru bisa mencari sendiri (kotak cari: "es batu", "listrik").',
      'Sifat catatan: Umum (semua bisa lihat), Admin saja, atau Rahasia (Entity Admin & Owner, mis. temuan sidak soal orang). Kasir hanya bisa membuat laporan; kontak dan panduan diisi admin. Kontak/panduan "semua gerai" diisi dari Entity Admin.',
      'Fitur ini bisa dimatikan Owner di Pengaturan (saklar "Info Gerai").'
    ].join('\n'),
    tawaran: [],
    tanpaAksi: 'Info Gerai diisi langsung dari tombolnya di kasir atau Entity Admin; Una belum mencatat laporan sendiri.'
  },
  // Cek HP /diagnostik (Bos Cyo, 2026-10-19): public/diagnostik.js, src/diagnostik-laporan.js.
  {
    id: 'cek_hp',
    judul: 'Cek HP (/diagnostik): tombol tidak muncul, tidak bisa login, aplikasi aneh di HP tertentu',
    kunci: ['cek hp', 'diagnostik', 'diagnosis', 'tombol tidak muncul', 'tombol ga muncul', 'tombol hilang', 'kolam qris tidak muncul', 'tidak bisa login', 'gak bisa login', 'aplikasi error', 'halaman tidak muncul', 'dns', 'hp bermasalah', 'versi lama'],
    isi: [
      'Kalau di satu HP ada tombol/menu yang tidak muncul (mis. "Kolam QRIS"), tidak bisa login, atau aplikasi terasa aneh padahal di HP lain normal: buka alamat /diagnostik di browser HP itu (di layar Login Kasir ada tautan "🩺 Ada yang tidak muncul / tidak bisa login? Cek HP").',
      'Halaman itu memeriksa sendiri: penyimpanan browser, jam HP, versi halaman kasir yang dipakai HP (versi lama atau terbaru), modul QRIS termuat atau tidak, error JavaScript di kasir 3 hari terakhir, dan apakah domain aplikasi terjangkau dari jaringan HP (DNS operator yang memblokir/lambat). Hasilnya otomatis terkirim ke tim MAXI dan muncul "Kode laporan" (mis. D-AB3K9) — sebutkan kode itu ke admin.',
      'Boleh menulis masalahnya di kotak catatan lalu tekan "Kirim ulang + catatan". Kalau versi halaman kasir tertulis lama, tekan "🧹 Bersihkan & buka kasir". Tidak perlu mengubah setelan HP (mis. DNS) sendiri; penyebabnya dibetulkan di program.',
      'Yang dikirim hanya hasil pemeriksaan, jenis browser, dan nama operator jaringan; kata sandi dan token tidak pernah dikirim.'
    ].join('\n'),
    tawaran: [],
    tanpaAksi: 'Pemeriksaan HP dijalankan dari halaman /diagnostik di HP yang bermasalah; Una tidak bisa memeriksa HP dari jauh.'
  },
  // QRIS Otomatis (Bos Cyo, 2026-10-16): src/qris-otomatis.js, public/qris-otomatis.js, public/qris-kasir.js.
  {
    id: 'qris_otomatis',
    judul: 'QRIS Otomatis: bunyi uang masuk & tautan penjualan QRIS',
    kunci: ['qris', 'qris otomatis', 'ini pembeliku', 'minta klaim', 'klaim diminta', 'lepaskan klaim', 'pertahankan klaim', 'klaim lambat', 'cek qris', 'kolam qris', 'klaim qris', 'batal klaim', 'diklaim gerai lain', 'salah klaim', 'qris masuk', 'uang qris', 'notif qris', 'bunyi qris', 'qris belum tertaut', 'tautkan qris', 'belum tertaut', 'hp penerima', 'macrodroid', 'gobiz', 'mutasi qris', 'qris palsu'],
    isi: [
      'Uang QRIS yang benar-benar masuk dicatat dari notifikasi aplikasi merchant (GoBiz, bank, dll.) di SATU HP penerima milik pemilik — CS tidak memasang aplikasi merchant. HP itu meneruskan notifikasinya ke Leker lewat aplikasi Penerus QRIS (dari admin; MacroDroid hanya untuk aplikasi merchant bernotifikasi teks biasa — Merchant BCA tidak bisa).',
      'Begitu uang masuk, kasir gerai itu mendengar bunyi "cring" dan melihat pita hijau "💰 QRIS masuk Rp…". Saat aplikasi ditutup, kabarnya datang lewat notifikasi HP (aktifkan dulu di menu Notifikasi).',
      'Di kasir tidak ada tombol tersendiri: QRIS ada di menu "📊 Data". Kolom "Cara bayar" menampilkan Tunai/QRIS/Campuran, filter "Cara bayar" menyaring Tunai/QRIS/Campuran, dan tombol "Kolam QRIS" di sebelah "Stok" membuka uang yang belum diklaim gerai mana pun. Kolam QRIS tidak berada di pilihan filter "Cara bayar". Filter "Status klaim" di dalam kolam berisi "Semua", "Belum diklaim", dan "Sudah diklaim". Setiap kolam dibuka, defaultnya "Belum diklaim"; data diminta sesuai filter dari server. Di Entity Admin: tombol "📲 QRIS" di tiap kartu gerai.',
      'CS CUKUP MENGKLAIM (saklar "QRIS: penautan oleh sistem", bawaan aktif sejak 19 Okt 2026): begitu pembeli membayar QRIS, buka "Kolam QRIS", cari nominal + jam (+ "dari DANA/GOPAY…") lalu tekan "✋ Klaim". CS tidak perlu menautkan ke penjualan — tidak ada jendela "Pilih uang QRIS-nya" sesudah penjualan dan tidak ada tombol QRIS merah/hijau. Besoknya, saat mutasi bank H+1 diunggah Entity Admin, sistem yang menautkan uang ke penjualan QRIS dan mencatat kesalahan tiap CS di Raport: salah klaim (mengklaim uang pembeli gerai lain), tidak klaim (uang masuk ke gerainya tapi tidak diklaim), dan nominal QRIS tidak sesuai (penjualan QRIS tanpa uang, atau uang QRIS yang dicatat dengan cara bayar lain).',
      'Kolam QRIS hanya berisi uang HARI INI — uang kemarin yang belum atau salah diklaim sudah ditangani sistem lewat mutasi. Klaim paling lambat 10 menit sesudah notifikasinya muncul; lebih dari itu tercatat "klaim lambat" di Raport. Uang pembelimu sudah diklaim gerai lain? Di Kolam QRIS pilih "Sudah diklaim", tekan "🙋 Ini pembeliku" pada uangnya: CS gerai itu mendapat notifikasi dan di kolamnya muncul "🙋 Klaim gerai kamu diminta gerai lain" dengan pilihan "Lepaskan untuk <gerai>" (klaim pindah ke peminta) atau "Pertahankan". Peminta mendapat notifikasi jawabannya. Mutasi bank besok tetap yang menentukan: klaim yang dipertahankan padahal salah tercatat salah klaim.',
      'Bila saklar itu dimatikan Owner: tiap penjualan QRIS punya tombol kecil "QRIS" di menu Data (merah = belum tertaut, hijau = sudah), jendela "📲 Pilih uang QRIS-nya" muncul sesudah menyimpan penjualan QRIS/campuran, dan CS sendiri yang memilih uang masuknya ("Pakai" = klaim + tautkan). Kalau nominal sama dan waktunya berdekatan (±30 menit) tanpa keraguan, Leker menautkan sendiri. Satu uang masuk tidak bisa dipakai dua kali.',
      'Status: hijau = Tertaut; kuning = Belum tertaut (penjualan QRIS tanpa uang masuk — perlu dicek); merah = uang masuk tanpa penjualan. CS tidak bisa membuat uang masuk sendiri, jadi orderan QRIS karangan tetap kuning.',
      'Kolam bersama (saklar "QRIS: kolam bersama + klaim CS", bawaan aktif): bila satu akun merchant memegang banyak outlet (mis. merchantBCA) dan notifikasinya tidak menyebut outlet, uang masuk menunggu di "🧾 Kolam QRIS" yang terlihat semua kasir yang lacinya terbuka — tanpa bunyi. Begitu pembelinya membayar, CS mencari nominal + jam (+ "dari DANA/GOPAY…") lalu menekan "✋ Klaim untuk <gerai>"; gerai lain terkunci. Kepencet? tekan "Batal klaim" (uang kembali ke kolam). Bila hanya ada satu penjualan QRIS bernominal sama, klaim langsung menautkannya. Admin bisa membatalkan klaim gerai mana pun dengan catatan; pencocokan mutasi bank (outlet asli) menangkap klaim yang salah gerai.',
      'Admin bisa: tambah uang masuk manual dari mutasi (wajib catatan), lepas tautan, abaikan uang masuk (mis. uji coba), dan menautkan nominal yang beda dengan alasan. Entity Admin memasukkan uang yang gerainya belum dikenali ke gerai yang benar.',
      'Setelan (tab ⚙️ Setelan, admin): pilih cara bayar yang dihitung QRIS, kata kunci gerai di teks notifikasi, dan buat HP penerima (alamatnya tampil sekali, ditempel ke aplikasi Penerus QRIS).',
      'Fitur ini bisa dimatikan Owner di Pengaturan (saklar "QRIS Otomatis").'
    ].join('\n'),
    tawaran: [],
    tanpaAksi: 'Klaim QRIS dilakukan CS di Kolam QRIS (menu Data, di sebelah Stok); tautan ke penjualan dibuat sistem dari mutasi bank. Una tidak mengklaim atau menautkan uang sendiri.'
  },
  // Validasi QRIS dengan mutasi bank (Bos Cyo, 2026-10-18): src/qris-mutasi.js, public/bca-mutasi-baca.js.
  {
    id: 'qris_mutasi',
    judul: 'Mutasi Merchant BCA (H+1): sistem menautkan QRIS & mencatat kesalahan CS',
    kunci: ['mutasi qris', 'mutasi bca', 'validasi qris', 'cocokkan mutasi', 'upload mutasi', 'unggah mutasi', 'report merchant bca', 'salah gerai', 'klaim salah', 'cek klaim qris', 'kroscek qris', 'notifikasi tidak sampai', 'raport qris', 'catatan qris', 'tidak klaim', 'nominal qris tidak sesuai', 'proses ulang mutasi'],
    isi: [
      'Mutasi Merchant BCA baru bisa diekspor H+1. Entity Admin → tombol "📲 QRIS" di kartu gerai → tab "🏦 Mutasi BCA": pilih file Excel "Transaction Report by Merchant BCA", isi kata sandi file dari BCA, tekan "Baca & proses". File dibuka di perangkat itu sendiri; yang dikirim ke Leker hanya baris transaksinya. Unggah ulang file yang sama tidak membuat dobel.',
      'Sekali di awal: pasangkan tiap outlet BCA (Merchant ID) ke gerai di bagian "Outlet BCA → gerai". Nama outlet di BCA bisa beda dengan nama gerai (mis. "TEH POCI GADANG" = Beji), jadi periksa tebakannya lalu tekan Simpan.',
      'Sesudah diunggah, sistem memproses sendiri tanpa tombol per baris: tiap transaksi mutasi dipasangkan dengan notifikasinya (nominal, jam, dompet pembayar — notifikasi yang telat berjam-jam tetap terpasang); uang yang diklaim gerai lain atau tidak diklaim dipindah ke gerai asli outletnya; notifikasi yang tidak pernah sampai dibuatkan uang masuknya; lalu uang ditautkan ke penjualan QRIS gerai itu (nominal sama, waktu terdekat). "Proses ulang tanggal ini" mengulang semuanya dengan hasil yang sama.',
      'Paling atas: "Uang QRIS per gerai" — dihitung dari mutasi saja, tanpa melihat klaim atau notifikasi: QRIS masuk di mutasi vs transaksi QRIS yang tercatat, per gerai dan per laci (dari jam buka sampai jam tutup laci CS). "Uang sesuai" berarti uangnya benar walau CS punya catatan (berarti hanya salah cara mengoperasikan); "Uang kurang" berarti transaksi QRIS lebih besar dari uang yang masuk; "Uang lebih" berarti ada uang QRIS yang tidak dicatat sebagai transaksi QRIS. Gerai yang selisih tampil paling atas.',
      'Hasilnya: status tiap transaksi (Tertaut ke penjualan / Tidak ada penjualan QRIS-nya / Outlet belum dipasangkan), daftar penjualan QRIS yang uangnya tidak ada di mutasi, daftar notifikasi tanpa baris mutasi, dan "Catatan per CS": salah klaim, tidak klaim, dan nominal tidak sesuai, lengkap dengan keterangan tiap kejadian, ditambah "klaim lambat" (diklaim lebih dari 10 menit sesudah notifikasi muncul) dan "total klaim ≠ penjualan QRIS" (jumlah uang yang diklaim CS sehari dibanding jumlah penjualan QRIS yang ia catat; bagian "Klaim vs penjualan QRIS per CS" menampilkan angkanya). Catatan ini ikut Raport kasir ("Catatan QRIS") dan portal staf. "Tidak klaim" dan "uang tanpa penjualan" dibebankan ke CS yang lacinya terbuka saat uang masuk; "penjualan QRIS tanpa uang" ke CS yang mencatat penjualannya.'
    ].join('\n'),
    tawaran: [jelas('qris_otomatis', 'Cara kerja QRIS Otomatis')],
    tanpaAksi: 'Mutasi diunggah sendiri oleh Entity Admin dari file BCA; Una tidak membuka file atau kata sandinya.'
  },
  // Tata cara menyambungkan HP merchant ke Leker (Bos Cyo, 2026-10-17; dicoba dengan merchantBCA).
  {
    id: 'qris_sambung_hp',
    judul: 'Menyambungkan HP aplikasi merchant QRIS ke Leker',
    kunci: ['sambung hp qris', 'hp penerima', 'penerus qris', 'aplikasi penerus', 'pasang macrodroid', 'macrodroid', 'merchant bca', 'merchantbca', 'notif qris telat', 'qris telat', 'telat terus', 'notifikasi qris terlambat', 'cara setting qris', 'setting qris otomatis', 'qris tidak bunyi', 'qris belum masuk leker'],
    isi: [
      'Cukup sekali. Sesudahnya tiap QRIS masuk diteruskan sendiri ke Leker — tidak perlu screenshot.',
      '1) Entity Admin → tombol "📲 QRIS" di kartu gerai → tab "⚙️ Setelan": pilih cara bayar yang dihitung QRIS, isi kata kunci gerai (nama outlet seperti tertulis di notifikasi, mis. "TEH POCI BENDUNGAN", atau NMID). Ulangi untuk tiap gerai.',
      '2) Masih di Setelan: isi nama HP, centang "Untuk semua gerai" bila satu akun merchant memegang banyak outlet, tekan "＋ Buat HP penerima". Salin alamat yang muncul (hanya tampil sekali) ke HP merchant.',
      '3) Di HP merchant: izinkan notifikasi aplikasi merchant (di Merchant BCA: Akun → Pengaturan Notifikasi → aktif) dan Pengaturan HP → Aplikasi → aplikasi merchant → Baterai "Tidak dibatasi" (+ Autostart bila ada). Izin notifikasi yang mati + pembatasan baterai inilah penyebab notifikasi telat berjam-jam.',
      '4) Pasang aplikasi Penerus QRIS (APK dari admin). Buka → Tempel alamat → Simpan; pastikan "Akses notifikasi" dan "Baterai" ✅; "Aplikasi yang diteruskan" bawaan com.bca.msb (Merchant BCA). Penerus QRIS bisa membaca tampilan khusus notifikasi Merchant BCA, menyimpan kiriman saat HP offline lalu mengirim ulang, dan mengirim jam notifikasi muncul. (MacroDroid hanya cocok untuk aplikasi merchant bernotifikasi teks biasa.)',
      '5) Tekan "Kirim tes" di Penerus QRIS, lalu uji transfer Rp1. Di Setelan, baris HP penerima menulis hasilnya (mis. "Uang masuk Rp1 (masuk kolam bersama)"). Dengan kolam bersama (bawaan), uang muncul di "🧾 Kolam QRIS" kasir tanpa bunyi; tanpa kolam bersama, gerai dikenali dari kata kunci dan kasirnya mendengar bunyi.',
      'HP merchant boleh HP harian, asal selalu menyala dan ada internet. Kalau HP mati, notifikasinya tidak sampai; besoknya saat mutasi H+1 diunggah, sistem membuat sendiri uang masuknya. Notifikasi yang telat tetap tercatat di jam transaksinya (dibaca dari teks notifikasi), dan nomor RRN mencegah dobel.'
    ].join('\n'),
    tawaran: [jelas('qris_otomatis', 'Cara kerja QRIS Otomatis')],
    tanpaAksi: 'HP penerima dibuat sendiri oleh admin di tab Setelan karena alamatnya rahasia; Una tidak membuatkannya.'
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
      'Jadwal ini dipakai untuk menandai telat. Kebijakan batas jadwal tenant menentukan apakah presensi di luar jadwal dihitung gaji.'
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
      'Jika kebijakan batas jadwal aktif, presensi di luar jadwal ditandai "Di luar jadwal, tidak dihitung". Datang lebih awal dari jam shift tidak dianggap di luar jadwal: gajinya dihitung mulai jam shift (berlaku mulai 14 Okt 2026).'
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
      'Salah input? Penyesuaian bisa dibatalkan dengan alasan — tidak dihapus diam-diam, tetap tercatat jejaknya.',
      'Penyesuaian langsung dijurnal di Akuntansi (bonus: Debit Beban Gaji / Kredit Utang Gaji atas nama CS itu; potongan kebalikannya) bertanggal sesuai tanggal yang diisi, dan ikut saldo Riwayat Hutang Gaji serta Pembayaran Hutang Gaji. Dibatalkan = jurnal pembalik di tanggal yang sama.'
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
      'Kalau telatnya karena alasan sah (mis. aplikasi error), CS mengajukan revisi jam dari Portal Staf → Riwayat Presensi → "Ajukan revisi jam" (kapan pun, juga setelah pulang); Owner/Entity Admin ACC, edit lalu ACC, atau tolak di Entity Admin → Izin CS.',
      'Kalau mekanisme Dana Apresiasi & Denda aktif (Entity Admin → Pengaturan), menit telat CS asli otomatis dipotong apresiasi per jam (Rp2.400/jam, telat 10 menit = Rp400); denda baru muncul kalau gerai kosong 3 jam atau lebih — tidak perlu input denda manual lagi.'
    ].join('\n'),
    tawaran: [buka('cashiers'), buka('attendance-report')],
    aksi: { alat: 'penyesuaian_gaji', tawar: 'Mau Una catatkan dendanya? Sebut mis. "potong gaji Rika 20rb kemarin karena telat".', tombol: 'Una catatkan denda', awal: { pg_jenis: 'potong' } }
  },
  {
    id: 'presensi_gagal',
    judul: 'CS tidak bisa presensi',
    kunci: ['tidak bisa presensi', 'gagal presensi', 'tidak presensi', 'lupa presensi', 'lupa absen', 'tidak absen', 'gagal absen', 'tidak ada rekap presensi', 'presensi hilang', 'koreksi presensi'],
    isi: [
      'CS sendiri yang mengajukan revisi dari Portal Staf → Riwayat Presensi:',
      '• Jam masuk/pulang salah (telat karena lupa absen, web error, pulang tercatat otomatis) → tombol "Ajukan revisi jam" di sesi itu, isi jam sebenarnya + alasan. Bisa untuk sesi yang masih berjalan maupun yang sudah selesai, tanpa batas waktu.',
      '• Tidak presensi sama sekali → tombol "Lupa presensi? Ajukan sesi", isi tanggal, jam datang & pulang + alasan.',
      'Owner/Entity Admin memutuskan di Entity Admin → Izin CS: ACC, "Edit lalu ACC" (jamnya disesuaikan kebijakan), atau Tolak dengan alasan. Kalau di-ACC, jam presensi diganti (jam asli tetap tercatat), gaji sesi itu dihitung ulang dengan jurnal pembalik + jurnal revisi, dan potongan dana apresiasi/denda shift itu ikut dinilai ulang.',
      'Tambahan di luar jam (lembur, insentif) tetap lewat Akun Kasir → "💰 Gaji" → Penyesuaian Gaji.'
    ].join('\n'),
    tawaran: [buka('attendance-report'), buka('permit-report'), buka('cashiers')],
    aksi: { alat: 'penyesuaian_gaji', tawar: 'Mau Una tambahkan gaji hari yang tidak terhitung? Sebut mis. "tambah gaji Rika 80rb tgl 5 karena tidak bisa presensi".', tombol: 'Una tambahkan gaji', awal: { pg_jenis: 'tambah' } }
  },
  {
    id: 'fina_pengaturan',
    judul: 'Pengaturan Fina (HR)',
    kunci: ['pengaturan fina', 'aturan hr', 'pengaturan hr', 'deteksi gerai kosong', 'gerai dianggap kosong', 'tawaran backup', 'freelance ditawari', 'batas tunggu backup', 'backup lintas gerai', 'masa berlaku sp', 'tingkatan sp', 'tingkat sp', 'kop surat'],
    isi: [
      'Diatur di Entity Admin → Pengaturan → kartu "Fina (HR)": bawaan entity, dan tiap gerai bisa diatur khusus. Isian kosong = ikut bawaan entity, lalu bawaan aplikasi.',
      'Isinya: gerai dianggap kosong setelah berapa menit tanpa presensi (bawaan 10), berapa freelance ditawari sekaligus (3), lapor admin bila tak ada yang bisa dalam berapa menit (30), boleh backup dari gerai lain atau tidak (ya), masa berlaku SP dalam hari (90), tingkatan SP dari yang paling ringan (TEGURAN, SP1, SP2, SP3), dan kop surat.',
      'Simpan lewat "Simpan bawaan Fina" atau "Simpan Fina gerai …". Tarif apresiasi dan denda tidak diatur di sini; tetap di kartu Dana Apresiasi. Fina hanya menyiapkan data dan draft, keputusan soal orang dan uang tetap di Admin.'
    ].join('\n'),
    tawaran: [jelas('dana_apresiasi', 'Dana apresiasi & denda')], tanpaAksi: 'pengaturan HR diubah lewat kartu Fina (HR) di Entity Admin'
  },
  {
    id: 'kelola_akun', judul: 'Kelola akun kasir per gerai & peta akun',
    kunci: ['kelola akun', 'akun kasir', 'akun aktif', 'akun per gerai', 'peta akun', 'akun gerai', 'nonaktifkan akun', 'aktifkan akun', 'akun tes', 'presensi basi', 'presensi terbuka', 'gerai aktif'],
    isi: [
      'Di Entity Admin → Karyawan → tombol "🔑 Kelola akun". Muncul akun kasir tiap gerai (seperti daftar karyawan): status Aktif/Nonaktif, CS asli/Freelance, karyawan tertaut, jadwal, dan presensi terakhir.',
      'Peta akun tiap gerai: baris jam 1-24 (jam 1 = 00:00-01:00), kolom Senin..Minggu dengan satu kolom kecil per akun aktif yang berjadwal. Kolom "Gerai aktif": hijau = ada akun, hijau tua = 2+ akun, merah muda = kosong di jam operasional (jam operasional diisi di Dana Apresiasi).',
      'Peringatan per akun: presensi masih terbuka lebih dari 16 jam (bisa terbaca "sedang jaga" di Dana Apresiasi, juga untuk akun nonaktif), karyawan tertaut sudah nonaktif/resign, belum tertaut karyawan, CS asli tanpa jadwal, jadwal lewat tengah malam, tidak presensi 30 hari.',
      'Tombol "Nonaktifkan"/"Aktifkan" mengubah akun (sesi login diputus), sama dengan Admin Gerai → Akun Kasir. Presensi yang masih terbuka tidak ikut ditutup; jadwal tetap diubah di Akun Kasir.'
    ].join('\n'),
    tawaran: [jelas('dana_apresiasi', 'Dana apresiasi & denda')], tanpaAksi: 'akun diaktifkan/nonaktifkan lewat tombol di Kelola akun'
  },
  {
    id: 'dana_apresiasi',
    judul: 'Dana apresiasi backup & denda tidak masuk',
    kunci: ['dana apresiasi', 'apresiasi', 'apresiasi backup', 'denda', 'denda tidak masuk', 'denda absen', 'cs tidak masuk', 'cs berhalangan', 'gantikan', 'menggantikan', 'potongan apresiasi', 'shift kosong', 'gerai kosong', 'freelance', 'cs asli', 'alasan syari', 'jam operasional'],
    isi: [
      'Diatur di Entity Admin → Pengaturan → "Dana Apresiasi & Denda CS" (bawaan entity + bisa beda per gerai; bawaannya ON).',
      'Setiap jam shift CS asli yang tidak dia jaga (tidak masuk, telat, pulang awal) dipotong apresiasi per jam (bawaan Rp2.400) dari hutang gajinya:',
      '• jam yang dijaga backup → diteruskan ke backup sebagai "Apresiasi backup" (lewat akun penampung 2105, saldonya harus 0);',
      '• jam yang kosong → masuk Pendapatan Lainnya.',
      'Denda dari lamanya gerai KOSONG (tidak ada yang jaga) dalam satu shift: bawaan kosong 3-4 jam Rp10.000, lebih dari 4 jam Rp20.000, kurang dari 3 jam tanpa denda. Denda ON/OFF, batas jam, dan nominalnya bisa diubah di pengaturan yang sama. Hutang gaji boleh minus (lebih bayar).',
      'Hanya akun berstatus CS asli yang dinilai (status diatur di pengaturan yang sama; akun backup entity bawaannya Freelance). Dihitung otomatis 1 jam setelah jam pulang shift, mulai tanggal "Mulai dihitung" di pengaturan. Telat 1 menit pun dihitung (tanpa toleransi), jadi pastikan jadwal shift dan hari libur tiap CS benar.',
      'Backup memilih "menggantikan siapa" saat presensi masuk (bawaan otomatis dari jadwal); Entity Admin bisa mengoreksi di "Rekap & penyesuaian".',
      'Alasan syar\'i: Entity Admin buka "Rekap & penyesuaian" → tombol Penyesuaian di baris potongan/denda; bawaannya membatalkan penuh, nominal & keterangan bisa diubah.',
      'Isi jam operasional gerai supaya muncul peringatan kalau jadwal CS asli tidak menutup jam buka gerai.'
    ].join('\n'),
    tawaran: [],
    tanpaAksi: 'pengaturan dan penyesuaiannya ada di Entity Admin, belum lewat Una'
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
].map((entri) => Object.freeze({
  ...entri, ...(SUMBER_KAMUS[entri.id] ?? {}), diperiksa: TINJAUAN[entri.id] ?? null
})));


function kamusKonteks(opsi = {}) {
  const skin = normalisasiSkin(opsi.skin);
  return KAMUS.map((e) => {
    const hasil = { ...pilihVarian(e, { skin }) };
    const tersedia = menuUntuk(opsi);
    hasil.tawaran = (hasil.tawaran ?? []).flatMap((t) => {
      if (t.jenis !== 'buka') return [t];
      const tab = skin === 'f' && ['resep', 'satuan'].includes(e.id) && t.layar === 'manufacturing' ? 'racikbahan' : t.layar;
      const menu = tersedia.find((m) => m.tab === tab && (!t.halaman || m.halaman === t.halaman));
      return menu ? [{ ...t, layar: tab, halaman: menu.halaman, label: 'Buka layar ' + menu.label }] : [];
    });
    for (const biasa of PETA_UNA.filter((p) => p.skin === 'classic' && p.halaman === 'gerai')) {
      const aktual = tersedia.find((p) => p.tab === biasa.tab && p.halaman === 'gerai');
      if (!aktual) continue;
      hasil.isi = hasil.isi.replaceAll(biasa.grup + ' ? ' + biasa.label, aktual.grup + ' ? ' + aktual.label);
    }
    if (['akun_cs','gaji_harian','telat_gaji'].includes(e.id)) hasil.isi += '\nBatas gaji di luar jadwal berlaku bila kebijakan batas jadwal tenant aktif; saat dimatikan sesi itu tetap dihitung. Jadwal hari yang belum diisi tidak membatasi.';
    return hasil;
  });
}
export function peringkatTopik(teks, n = 3, opsi = {}) {
  return peringkatKamus(teks, kamusKonteks(opsi), {
    // Entri ber-tag agen (mis. agen: ['fina']) hanya untuk persona itu; tanpa tag = semua persona.
    // Pemanggil tanpa persona = Una, jadi jawaban Una tidak tergeser entri khusus Fina/Rika.
    normalisasi: normalkan, kata: kataInti, konteks: { skin: normalisasiSkin(opsi.skin), agen: opsi.agen || 'una' }, minimum: 2
  }).slice(0, n);
}
export function cariTopikSkor(teks, opsi = {}) {
  return peringkatTopik(teks, 1, opsi).find((e) => e.skor >= 3) ?? null;
}
export function cariTopik(teks, opsi = {}) { return cariTopikSkor(teks, opsi)?.entri ?? null; }

/** Jawaban siap tampil: kalimat + tawaran. Topik tak dikenal → daftar topik. */
export function jelaskan(teks, { halaman = 'gerai', skin = 'classic', peran, agen } = {}) {
  const opsi = { halaman, skin, peran, agen };
  const topik = cariTopikSkor(teks, opsi);
  // Peta menu aplikasi (dibangkitkan dari daftar menu sungguhan, src/caca-peta.js)
  // menang kalau kecocokannya lebih kuat dari panduan kamus — mis. "bikin pengumuman
  // buat karyawan" adalah menu Pengumuman, bukan panduan akun kasir.
  const cocok = cariMenu(teks, opsi);
  // Panduan kamus yang menunjuk layar yang sama dengan menu itu selalu menang: isinya lebih lengkap.
  const layarSama = Boolean(topik && cocok && (topik.entri.tawaran ?? []).some((t) => t.layar === cocok.menu.tab));
  const khususSkin = cocok && ['racikbahan', 'cetak'].includes(cocok.menu.tab) && /\b(di mana|dimana|atur bahan|antrian|antrean)\b/i.test(teks);
  const entri = !khususSkin && topik && (!cocok || layarSama || topik.skor >= cocok.skor) ? topik.entri : null;
  if (!entri) {
    if (cocok) {
      return {
        ok: true,
        dikenal: true,
        topik: `menu:${cocok.menu.tab}`,
        judul: cocok.menu.label,
        jawaban: jawabanMenu(cocok.menu),
        tawaran: [{ jenis: 'buka', layar: cocok.menu.tab, halaman: cocok.menu.halaman, label: `Buka ${cocok.menu.label}` }]
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
    const opsi = { halaman, skin: ctx.skin ?? ctx.uiSkin ?? 'classic', peran: ctx.peran, agen: ctx.agen };
    let hasil = jelaskan(t?.jelaskan_topik, opsi);
    if (!hasil.dikenal && ctx.pesan) {
      const dariPesan = jelaskan(ctx.pesan, opsi);
      if (dariPesan.dikenal) hasil = dariPesan;
    }
    return { ok: true, jawaban: hasil.jawaban, tawaran: hasil.tawaran, kerjakan: hasil.kerjakan ?? null, panduan: hasil };
  }
});
