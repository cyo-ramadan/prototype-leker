# Skin H - Owner Merangkap Admin

Bos Cyo, diperbarui 12 Oktober 2026.

## Status

Skin H sudah diimplementasikan secara lokal pada branch `codex/skin-h-owner-admin`. Kode belum di-push, belum di-deploy, dan belum mengubah skin tenant produksi sesuai instruksi Bos Cyo.

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

Penghapusan transaksi tetap memakai persetujuan eksplisit satu ketukan. Tidak ada bypass penghapusan otomatis. Ini menjaga pembalikan stok, kas, dan jurnal tetap dapat diperiksa owner.

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
- panel putih;
- tombol utama teal gelap;
- tombol pendamping kuning pasir;
- target sentuh minimal 44 px;
- pada HP, empat kelompok Admin tetap terlihat dan sub-menu membungkus.

Seluruh CSS portal diawali `html[data-skin="h"]` dan komponen portal dibongkar saat skin bukan H. Definisi warna dan token H berdiri sendiri dan tidak mewarisi Skin A-G.

## Verifikasi lokal

- `npm test`: 1.847 lulus, 0 gagal.
- `npm run check`: 319 file lulus pemeriksaan sintaks.
- Uji Worker lokal: login Owner 200, context Admin Entity 200, 11 gerai terbaca, konfigurasi KANTOR 200, sesi Kantor 200, laci OPEN, inbox lintas gerai 200.
- Uji isolasi: H ke skin biasa membuat portal 403; kembali ke H tidak menghidupkan token Kantor lama (403); sesi baru berhasil (200).
- `git diff --check`: tidak ada whitespace error.

Chrome sempat tersambung tetapi koneksi ekstensi hilang sebelum navigasi lokal, jadi screenshot viewport HP aktual belum dihasilkan. Pemeriksaan responsif dilakukan dari aturan CSS dan struktur DOM; jangan nyatakan validasi visual browser selesai sampai screenshot aktual berhasil.

## Batas produksi

Tidak ada migration baru untuk fitur ini. Database preview berada di `.wrangler` lokal dan tidak dilacak Git. Tenant produksi, gerai aktif, akun produksi, laci CS, dan transaksi produksi tidak diubah. Push tetap ditahan sampai Bos Cyo memutuskan.

DOC-IMPACT: CHANGED - implementasi lokal Skin H, portal Admin Entity, Kantor, persetujuan lintas gerai, riwayat permit laci, resep langsung, tema pantai, isolasi saat skin berubah, dan hasil validasi terbaru.
