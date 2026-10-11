# Skin H · Owner Kelola Sendiri

Bos Cyo, 11 Oktober 2026. Owner punya beberapa gerai dan kasir, tetapi administrasi dikerjakan sendiri. Codex menerapkan prinsip pengurangan keputusan dari DESAIN-SKIN-D-WARUNG.md; skill literal Steve Jobs tidak tersedia.

## Rancangan sebelum implementasi
Layar HP dimulai dengan untung hari ini, pengajuan yang perlu keputusan, lalu gerai yang bisa dibuka. Lima tujuan: Hari ini, Keputusan, Barang, Transaksi, Lainnya. Panel usaha menampilkan Hari ini, Gerai, Barang, Laporan, Lainnya. Menu teknis tetap tersedia di Lainnya; izin server tetap berlaku.

Arah visual: buku kendali harian. Kertas putih, latar abu biru pucat #F4F7FB, tinta #18283C, satu aksen biru #174EA6. DM Sans, angka tabular, garis pemisah tipis, ruang lapang. Tombol minimal 44 px. Navigasi lima kolom pada HP, tanpa carousel mendatar. Angka penting punya hirarki; hindari semua informasi tampak seperti kartu statistik seragam.

Barang baru default Barang Jadi + pcs, klasifikasi mengikuti default backend. Peran barang dan satuan terlihat untuk bahan. Resep opsional di barang: hasil, bahan, takaran, satu tombol simpan. Resep lama tetap immutable; simpan revisi dan sambungan dalam batch yang sama. Form tetap terbuka jika barang berhasil tetapi resep gagal; pesan membedakan hasilnya.

## Arahan terbaru dan batas aktivasi
Bos Cyo membatalkan pembuatan tenant/gerai percobaan dan mengizinkan memakai gerai yang ada karena CS dianggap sudah tutup laci. Kode clone dan form pembuatannya dibatalkan. Belum ada tenant, gerai atau akun yang dibuat. H bukan E: tidak melewati presensi, otomatis menyetujui, atau mengubah akses kasir.

Pemeriksaan D1 produksi 11 Oktober sekitar 22:25 WIB: Mandala tutup, tetapi G002 dan Tlekung masih punya laci OPEN dalam TEN-PROTOTYPE yang sama. Karena skin berlaku per tenant, belum diaktifkan pada tenant itu. Jangan menutup laci atas nama CS atau mengubah transaksi untuk mengatasi ini.

## Temuan untuk Bos Cyo sebelum perubahan tambahan
- Pengajuan tertunda bercampur riwayat panjang; sulit tahu mana yang perlu tindakan.
- Istilah peran barang dan klasifikasi akuntansi terlihat seperti dua jenis barang.
- Harga beli, pembelian terakhir dan HPP tampil berdekatan tanpa prioritas jelas.
- Ada nilai HPP yang jauh di atas harga jual pada layar yang dibaca. Belum dibuktikan penyebabnya; jangan ubah costing atau saldo tanpa audit.
- Pengaturan teknis, portal akuntansi dan tombol lintas peran mendominasi layar HP.

## Jalur resep H
POST /api/admin/manufacturing/products/:id/recipe, dengan query store wajib. Body: sourceRecipeId (null untuk resep pertama), outputQuantity, components [{productId, quantity}]. Endpoint memakai hak management dan tenant H. Revisi lama tidak diedit; nomor revisi baru dan link disimpan bersama. Sumber yang berubah ditolak 409. Retry isi yang sama tidak menambah revisi.

## Akses dan konsep visual
Bos Cyo sempat menyetujui akun khusus dua gerai percobaan setelah review otomatis menolak usulan awal. Rencana itu kemudian dibatalkan bersama tenant baru; tidak ada endpoint pembuatan akun yang ditambahkan. Koneksi Cloudflare tersedia, tetapi AGENT_ADMIN_TOKEN tidak ditemukan di proses/Windows User/Machine maupun binding Worker produksi. Jangan menganggap credential Cloudflare sebagai sesi aplikasi.

Tiga konsep gambar dibuat dengan built-in ImageGen: Fokus (putih-biru), Tenang (ivory-hijau), Langsung (prioritas keputusan, teal). Hasil dan prompt disimpan di C:/Users/Asus/output/owner-tenang-ui-20261011. Angka dan pengajuan pada gambar adalah ilustrasi, bukan hasil pembacaan data live. Konsep gambar belum diterapkan ke aplikasi.

## Batas pelaksanaan
Belum dinyatakan live atau selesai sampai resep diuji dari layar HP dan deployment terbukti. Tidak ada migration yang mengubah tenant aktif. Aktivasi tenant harus mempertimbangkan gerai lain dalam tenant yang sama.


Status pemeriksaan lokal terakhir: 311 pemeriksaan sintaks lulus (seluruh daftar npm run check dijalankan satu per satu karena batas panjang perintah Windows); seluruh 1.838 tes lulus, 0 gagal, setelah pembatalan clone. Uji integrasi HTTP lewat Worker lokal juga lulus: barang baru mendapat Barang Jadi + klasifikasi Accounting bawaan, resep tersambung, komponen dimuat ulang, retry tidak menambah revisi. Server QA memakai SQLite di memori dan tidak terhubung ke produksi.

Validasi visual implementasi H belum selesai: browser bisa membaca daftar tab tetapi interaksi/navigation berulang kali timeout. Tidak memakai kontrol browser di luar plugin sebagai pengganti. Tiga alternatif owner-kasir baru disimpan di C:/Users/Asus/output/owner-tenang-ui-20261011-v2: A papan tugas + kisi kasir, B gerai dahulu + daftar kasir, C inbox keputusan + pembayaran bertahap. Gambar pilihan belum diterapkan; menunggu preferensi Bos Cyo.

Tenant produksi tetap pada skin sebelumnya; tidak ada tenant/gerai/akun baru atau transaksi produksi yang dibuat oleh Codex. Rilis kode H tidak otomatis mengaktifkan skin pada tenant. Bukti deployment dicatat pada PR sebelum dinyatakan live.

DOC-IMPACT: CHANGED — skin H tenant, navigasi owner/admin, editor resep H, serta tiga konsep gambar. Rencana tenant/gerai/akun percobaan dibatalkan atas arahan Bos Cyo. Aturan stok, uang, presensi dan posting tetap memakai mesin yang sudah ada.
