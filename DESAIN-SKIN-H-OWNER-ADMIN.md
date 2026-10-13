# Skin H - Owner Merangkap Admin

Bos Cyo, diperbarui 13 Oktober 2026.

## Status

Skin H sudah live di Worker produksi dan tersedia sebagai pilihan tenant. Tidak ada tenant yang dipindahkan ke H secara otomatis; aturan khusus H baru aktif setelah tenant memilih `ui_skin=H`.

Skin ini ditujukan untuk owner yang mempunyai beberapa gerai, tidak mempunyai Admin terpisah, dan menjalankan satu gerai khusus sebagai Kantor.

## Portal tunggal Owner/Admin Entity

Owner membuka satu portal usaha pada `/entity-admin?entity=...`. Portal hanya muncul untuk entity aktif pada tenant dengan `ui_skin=H`.

Urutan layar:
1. Admin Entity untuk seluruh gerai di bagian atas.
2. Kasir Kantor di bagian bawah.

Menu utama Admin disederhanakan menjadi:
- Gerai: daftar gerai, detail laci, tim, akun kasir, presensi.
- Barang: Barang & resep, stok seluruh gerai, stok gerai, berbagi barang, kategori, supplier.
- Uang: setoran CS, biaya, hutang/piutang, rekening bersama, pembukuan lanjutan.
- Laporan: seluruh gerai, per gerai, riwayat transaksi.
- Pengaturan melalui satu tombol kecil: pelanggan, kontak gerai, dan pengaturan gerai.

Pekerjaan yang khusus satu gerai meminta pilihan gerai di portal yang sama. Owner masih dapat membuka portal CS yang sudah ada.

## Persetujuan seluruh gerai

Kotak persetujuan di bagian atas menggabungkan pengajuan dari seluruh gerai dalam entity:
- arus uang, arus barang, aset, dan penyesuaian stok;
- pembatalan transaksi;
- tutup laci;
- koreksi presensi dan izin GPS;
- setoran CS;
- pendaftaran pelanggan.

Sumber data dan handler keputusan lama tetap menjadi pemilik transaksi. Portal hanya menyatukan tampilan dan delegasi keputusan agar aturan akuntansi, stok, dan kas tidak diduplikasi.

Pada Skin H, saklar Auto Permit per gerai juga mencakup Permit Hapus Transaksi. Permit tetap dibuat dan jejak pemutus dicatat sebagai `AUTO_PERMIT`, lalu server menjalankan executor correction canonical yang sama dengan ACC manual. Bila pembalik tidak aman, status menjadi HOLD/FAILED dan Admin dapat memakai `RETRY_EXECUTION`; transaksi tidak dihapus paksa. Pada skin selain H, Permit Hapus Transaksi tetap menunggu ACC manual walaupun saklar Auto Permit gerai aktif.

## Kasir Kantor

Owner memilih tepat satu gerai dalam entity sebagai Kantor. Pilihan ini tersimpan per entity pada tenant Skin H.

Tombol Kantor:
- Jual
- Beli
- Catat uang
- Lainnya

Pada tampilan Kantor disembunyikan:
- Buka Laci
- Tutup Laci
- ACC Pelanggan
- Detail Laci

Laci Kantor dibuka melalui mesin laci canonical dan dianggap berjalan terus. Route tutup laci ditolak server untuk sesi Kantor. Tindakan operasional langsung owner tetap melewati mesin posting canonical, mencatat identitas manusia, dan tidak mengaktifkan Auto Permit permanen.

Token Kantor membungkus sesi manusia yang masih aktif dan diperiksa ulang pada setiap request. Token tidak disimpan di URL atau localStorage. Perubahan gerai Kantor, pencabutan sesi manusia, pergantian skin, serta putaran H ke skin lain lalu kembali ke H langsung membatalkan token lama.

## Detail laci dan permit

Detail Laci Skin H mempunyai bagian Izin & Perubahan yang memuat permit terkait laci:
- pengajuan operasional, termasuk penyesuaian stok;
- pembatalan transaksi;
- izin tutup laci.

Tampilan memuat gerai/laci, status, pengaju, pemutus, waktu, alasan, dampak stok, dan hasil eksekusi. Total laporan laci tetap berasal dari fakta transaksi canonical; riwayat permit tidak mengubah total.

## Barang dan resep

Pada Skin H resep opsional diisi langsung dari form Barang & resep. Barang baru mendapat default jenis/satuan dari backend yang sudah ada. Simpan resep membuat revisi immutable dan memperbarui link dalam batch yang sama. Perubahan sumber saat proses berjalan ditolak, dan retry dengan isi sama tidak menggandakan revisi.

## Tema visual

Skin H memakai latar pantai kuning-turquoise tanpa logo atau teks merek:
- aset: `public/owner-beach-h-v1.png`;
- panel buih biru muda, kartu barang putih, dan bingkai cyan;
- tombol utama biru laut `#006B99`, tombol pendamping kuning pasir;
- bilah atas kuning cerah dengan garis turquoise dan aksen hijau daun, mengikuti referensi pantai Bos Cyo;
- font Nunito Sans, heading 800 dan kontrol 700;
- modal buih dengan bingkai ombak, pembatas pasir, dan backdrop biru;
- arsip gambar konsep, prompt, checksum, dan aturan reuse: [library aset](design-assets/README.md); penyimpanan repo, belum ada mirror R2;
- target sentuh minimal 44 px;
- pada HP, empat kelompok Admin tetap terlihat dan sub-menu membungkus.

Seluruh CSS portal diawali `html[data-skin="h"]` dan komponen portal dibongkar saat skin bukan H. Definisi warna dan token H berdiri sendiri dan tidak mewarisi Skin A-G.

## Verifikasi

- Run penuh `npm test`: 1.858/1.860 lulus; dua kegagalan pemeriksaan UI berasal dari expected versi aset lama dan pemecahan koma di dalam selector `:is()`.
- Setelah kedua pemeriksaan diperbarui, `npm test -- test/ui-skin-tenant-toggle.test.js test/skin-gerai-akun-dan-gate-portal.test.js test/owner-entity-portal.test.js`: 15 lulus, 0 gagal. Source aplikasi tidak berubah setelah run penuh; suite backend yang sudah lulus tidak diulang. Pemeriksa selector tetap menangkap selector tanpa scope.
- `npm run check`: seluruh source lulus pemeriksaan sintaks.
- Tes integrasi membuktikan H + Auto Permit langsung menjalankan pembalik canonical; H dengan saklar mati tetap pending; skin lain dengan saklar aktif tetap pending.
- Tes retry membuktikan eksekusi pembalik aman diulang tanpa menerapkan koreksi dua kali.
- `git diff --check`: tidak ada whitespace error.

Pembaruan visual 2026-10-13: empat pasangan warna utama diperiksa kontrasnya: putih/biru 5,89:1, teks/tombol pasir 9,96:1, teks sekunder/panel buih 5,45:1, dan putih/hijau daun 5,12:1. Seluruh delapan path dan checksum PNG di manifest cocok. Preview HP pascaperubahan belum terverifikasi: koneksi browser berulang kali timeout; jangan menganggap tes source sebagai bukti visual perangkat fisik.

## Batas produksi

Tidak ada migration baru untuk perubahan ini. Pergantian skin tetap dilakukan dari kebijakan tenant dan setiap request membaca skin aktif dari server, sehingga aturan Auto Permit penghapusan langsung berhenti ketika tenant keluar dari H.

DOC-IMPACT: CHANGED 2026-10-13 - tema pantai sampai komponen dan katalog aset;  status live Skin H, Auto Permit Hapus Transaksi khusus H, executor pembalik canonical, isolasi saat skin berubah, dan hasil validasi terbaru.
