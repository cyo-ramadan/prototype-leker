# Instruksi Una: membetulkan HPP mulai September 2026

Dibuat 2026-10-03 oleh Hana atas permintaan Bos Cyo. Angka dihitung dari data produksi (hanya dibaca) pada 2026-10-03 siang, memakai alat `audit_hpp` yang sama dengan yang dimiliki Una.

## Cara pakai (untuk Bos Cyo)

1. Buka panel Una. **Pilih gerainya dulu** di pengalih lingkup (bukan "Buku entity"): alat koreksi HPP hanya bekerja per gerai.
2. Kalau gerai itu punya blok **Langkah 0** (membetulkan tipe barang), tempel itu dulu. Una menampilkan draft, cek, tekan **Ya**. Ini wajib duluan: bahan yang tercatat sebagai Barang Jadi tidak muncul di daftar yang boleh dikoreksi HPP-nya.
3. Tempel blok **Langkah 1** gerai itu. Una menampilkan **satu draft** berisi semua bahan (tabel: HPP sekarang, harga benar, tanggal mulai). Cek, tekan **Ya** satu kali. Una menjalankannya berurutan sambil menunjukkan kemajuan; jumlah penjualan dan selisih HPP tiap bahan tercatat di Riwayat Hitung Ulang HPP. Bahan yang ternyata sudah benar dilewati otomatis.
4. Ulangi untuk gerai berikutnya, lalu tempel blok **Penutup** untuk tiap gerai.

**Penting:** harga memakai **koma** sebagai desimal (`4,664` = Rp4 lebih sedikit, bukan empat ribu). Jangan diganti titik: `4.664` dibaca Una sebagai empat ribu enam ratus enam puluh empat (pemisah ribuan).

Kalau Una berhenti di tengah (mis. satu bahan ditolak), tombol "Lanjutkan dari ..." muncul; bahan yang sudah jalan tidak diulang.

Kirim **satu blok per pesan** (Langkah 0, lalu Langkah 1, lalu Penutup). Satu pesan maksimal 8.000 huruf; kalau lebih, Una menolak dengan jelas dan tidak mengerjakan sebagian.

## Dasar angka

- **Acuan = gerai yang tidak anomali.** BEJI dan SUGIONO paling bersih (harga beli konsisten; yang janggal hanya bahan yang belum pernah dibeli sehingga HPP-nya nol). Bahan yang belum punya harga di sebuah gerai memakai nilai tengah (median) harga beli gerai-gerai lain; bahan yang gerai itu sendiri beli dengan wajar memakai harga belinya sendiri (rata-rata tertimbang pembelian yang masuk akal; pembelian dengan jumlah salah catat, mis. "1 pcs" untuk 1 kg gula, tidak dihitung).
- **Larutan (Larutan Gula, Larutan Teh Poci ...) dihitung dari resep gerai itu sendiri** dengan harga bahan yang sudah benar. Karena takaran resep tiap gerai berbeda, harga larutan boleh berbeda antar gerai.
- **Tanggal mulai = hari pertama gerai itu bertransaksi** (bukan 1 September untuk semua), karena sebelum itu tidak ada penjualan yang dihitung ulang.
- Koreksi tidak mengubah stok, nominal pembelian, atau uang laci. Yang berubah: HPP penjualan sejak tanggal mulai (laba harian ikut bergeser), harga rata-rata bahan, dan jurnal koreksi (jurnal lama tidak diedit).

| Gerai | Mulai | Jumlah bahan | Perlu tipe dibetulkan dulu |
|---|---|---|---|
| BEJI | 2026-09-21 | 1 | tidak |
| SUGIONO | 2026-09-21 | 6 | ya (Langkah 0) |
| TLEKUNG | 2026-09-19 | 14 | ya (Langkah 0) |
| GENENGAN | 2026-09-22 | 5 | ya (Langkah 0) |
| DERMO | 2026-09-13 | 17 | tidak |
| PENDEM | 2026-09-01 | 12 | tidak |
| MANDALA | 2026-09-28 | 8 | ya (Langkah 0) |
| KALIURANG | 2026-09-29 | 15 | tidak |

NGIJO belum punya satu pun transaksi, jadi tidak ada yang perlu dihitung ulang; harga bahannya baru perlu diisi saat gerai itu mulai jalan.

## BEJI

**Langkah 1 — koreksi HPP** (1 bahan):

```
Una, koreksi HPP BEJI mulai 2026-09-21 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Lid Sealer = 39,5 per lbr
```

**Penutup:**

```
Una, sinkronkan akuntansi BEJI, lalu cek jembatan_masalah dan audit_hpp BEJI mulai 2026-09-21. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Orange.

## SUGIONO

**Langkah 0 — tipe barang** (tempel dulu, tekan Ya):

```
Una, di SUGIONO: betulkan Tipe Barang dulu pakai betulkan_klasifikasi_barang. Jenis Barang jangan diubah, satuan jangan diubah.
Tipe "bahan baku": Bahan Pentol Rangu.
```

**Langkah 1 — koreksi HPP** (6 bahan):

```
Una, koreksi HPP SUGIONO mulai 2026-09-21 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Bubuk Rasa Apel = 850 per pcs
2. Bubuk Rasa Black Curent = 850 per pcs
3. Bubuk Rasa Coklat = 1600 per pcs
4. Bubuk Rasa Leci = 1000 per pcs
5. Bubuk Rasa Milktea = 1500 per pcs
6. Lid Sealer = 39 per lbr
```

**Penutup:**

```
Una, sinkronkan akuntansi SUGIONO, lalu cek jembatan_masalah dan audit_hpp SUGIONO mulai 2026-09-21. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

## TLEKUNG

**Langkah 0 — tipe barang** (tempel dulu, tekan Ya):

```
Una, di TLEKUNG: betulkan Tipe Barang dulu pakai betulkan_klasifikasi_barang. Jenis Barang jangan diubah, satuan jangan diubah.
Tipe "bahan baku": Bahan Pentol Rangu.
```

**Langkah 1 — koreksi HPP** (14 bahan):

```
Una, koreksi HPP TLEKUNG mulai 2026-09-19 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Bubuk Rasa Apel = 850 per pcs
2. Bubuk Rasa Black Curent = 850 per pcs
3. Bubuk Rasa Coklat = 1600 per pcs
4. Bubuk Rasa Leci = 1000 per pcs
5. Bubuk Rasa Lemon Honey = 1000 per pcs
6. Bubuk Rasa Mangga = 850 per pcs
7. Bubuk Rasa Matcha = 3000 per pcs
8. Bubuk Rasa Milktea = 1500 per pcs
9. Cup Poci 160z = 775 per pcs
10. Sedotan = 52,1 per pcs
11. Teh Jasmine = 1500 per pcs
12. Teh Vanilla = 1500 per pcs
13. Larutan Teh Poci Jasmine = 1,072259 per ml
14. Larutan Teh Poci Vanilla = 1,072259 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi TLEKUNG, lalu cek jembatan_masalah dan audit_hpp TLEKUNG mulai 2026-09-19. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

## GENENGAN

**Langkah 0 — tipe barang** (tempel dulu, tekan Ya):

```
Una, di GENENGAN: betulkan Tipe Barang dulu pakai betulkan_klasifikasi_barang. Jenis Barang jangan diubah, satuan jangan diubah.
Tipe "bahan baku": Bahan Pentol Rangu.
```

**Langkah 1 — koreksi HPP** (5 bahan):

```
Una, koreksi HPP GENENGAN mulai 2026-09-22 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Bubuk Rasa Matcha = 3000 per pcs
2. Gula = 18,966667 per g
3. Teh Jasmine = 1500 per pcs
4. Larutan Teh Poci Jasmine = 4,664 per ml
5. Larutan Teh Poci Vanilla = 4,422475 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi GENENGAN, lalu cek jembatan_masalah dan audit_hpp GENENGAN mulai 2026-09-22. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

## DERMO

**Langkah 1 — koreksi HPP** (17 bahan):

```
Una, koreksi HPP DERMO mulai 2026-09-13 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Air Mineral = 0,583333 per ml
2. bahan pentol kriwil tulang rangu = 250 per pcs
3. Bubuk Rasa Apel = 850 per pcs
4. Bubuk Rasa Black Curent = 850 per pcs
5. Bubuk Rasa Coklat = 1600 per pcs
6. Bubuk Rasa Leci = 1000 per pcs
7. Bubuk Rasa Lemon Honey = 1000 per pcs
8. Bubuk Rasa Mangga = 850 per pcs
9. Bubuk Rasa Matcha = 3000 per pcs
10. Bubuk Rasa Milktea = 1500 per pcs
11. Gula = 17,5 per g
12. Susu Kental Manis = 1583 per pcs
13. Teh Jasmine = 1500 per pcs
14. Teh Vanilla = 1500 per pcs
15. Larutan Gula = 11,302083 per ml
16. Larutan Teh Poci Jasmine = 1,333333 per ml
17. Larutan Teh Poci Vanilla = 1,333333 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi DERMO, lalu cek jembatan_masalah dan audit_hpp DERMO mulai 2026-09-13. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Adonan Leker.

## PENDEM

**Langkah 1 — koreksi HPP** (12 bahan):

```
Una, koreksi HPP PENDEM mulai 2026-09-01 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Bubuk Rasa Apel = 850 per pcs
2. Bubuk Rasa Black Curent = 850 per pcs
3. Bubuk Rasa Capucino = 1600 per pcs
4. Bubuk Rasa Leci = 1000 per pcs
5. Bubuk Rasa Lemon Honey = 1000 per pcs
6. Bubuk Rasa Mangga = 850 per pcs
7. Bubuk Rasa Matcha = 3000 per pcs
8. Bubuk Rasa Milktea = 1500 per pcs
9. Lid Sealer = 48 per lbr
10. Sedotan = 53 per pcs
11. Teh Vanilla = 1500 per pcs
12. Larutan Teh Poci Vanilla = 1,25 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi PENDEM, lalu cek jembatan_masalah dan audit_hpp PENDEM mulai 2026-09-01. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Orange.

## MANDALA

**Langkah 0 — tipe barang** (tempel dulu, tekan Ya):

```
Una, di MANDALA: betulkan Tipe Barang dulu pakai betulkan_klasifikasi_barang. Jenis Barang jangan diubah, satuan jangan diubah.
Tipe "bahan baku": Bubuk Rasa Milktea, Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Coklat, Bubuk Rasa Black Curent, Bubuk Rasa Lemon Honey, Bubuk Rasa Leci, Bubuk Rasa Orange, Bubuk Rasa Apel, Bubuk Rasa Mangga, Teh Jasmine, Air Mineral, Susu Kental Manis, Cup Poci 160z, Sedotan, Lid Sealer, Bubuk Rasa Matcha, Teh Vanilla, Gula, Bahan Pentol Kecil Rangu.
Tipe "setengah jadi": Larutan Teh Poci Vanilla, Larutan Gula, Larutan Teh Poci Jasmine.
```

**Langkah 1 — koreksi HPP** (8 bahan):

```
Una, koreksi HPP MANDALA mulai 2026-09-28 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Air Mineral = 0,4375 per ml
2. Gula = 17,666667 per pcs
3. Lid Sealer = 39,5 per pcs
4. Sedotan = 52,1 per pcs
5. Teh Vanilla = 1500 per pcs
6. Larutan Gula = 11,315104 per ml
7. Larutan Teh Poci Jasmine = 1,003538 per ml
8. Larutan Teh Poci Vanilla = 1,1875 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi MANDALA, lalu cek jembatan_masalah dan audit_hpp MANDALA mulai 2026-09-28. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Kecil Rangu.

## KALIURANG

**Langkah 1 — koreksi HPP** (15 bahan):

```
Una, koreksi HPP KALIURANG mulai 2026-09-29 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Bubuk Rasa Apel = 850 per pcs
2. Bubuk Rasa Black Curent = 850 per pcs
3. Bubuk Rasa Coklat = 1600 per pcs
4. Bubuk Rasa Leci = 1000 per pcs
5. Bubuk Rasa Lemon Honey = 1000 per pcs
6. Bubuk Rasa Mangga = 850 per pcs
7. Bubuk Rasa Matcha = 3000 per pcs
8. Bubuk Rasa Milktea = 1500 per pcs
9. Cup Poci 160z = 775 per pcs
10. Sedotan = 52,1 per pcs
11. Teh Jasmine = 1500 per pcs
12. Teh Vanilla = 1500 per pcs
13. Larutan Gula = 8,968747 per ml
14. Larutan Teh Poci Jasmine = 4,337499 per ml
15. Larutan Teh Poci Vanilla = 4,337499 per ml
```

**Penutup:**

```
Una, sinkronkan akuntansi KALIURANG, lalu cek jembatan_masalah dan audit_hpp KALIURANG mulai 2026-09-29. Laporkan sisa yang belum beres.
```

Belum bisa dikoreksi (tidak ada bukti harga sama sekali, tunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange.

## Harga yang perlu Bos Cyo isi

Bahan di bawah ini HPP-nya nol di gerai-gerai yang disebut, dipakai resep, dan **tidak ada pembelian maupun gerai lain** yang bisa jadi acuan. Hana tidak mengarang harga. Isi harga per satuan, lalu tempel ke Una dengan format yang sama (`Nama = harga per satuan`) sesudah blok Langkah 1 gerai itu.

| Bahan | Satuan | Gerai yang terdampak | Harga benar |
|---|---|---|---|
| Bubuk Rasa Orange | pcs | BEJI, SUGIONO, TLEKUNG, GENENGAN, DERMO, PENDEM, MANDALA, KALIURANG | _isi_ |
| Bubuk Rasa Thaitea | pcs | SUGIONO, TLEKUNG, GENENGAN, DERMO, PENDEM, KALIURANG | _isi_ |
| Bubuk Rasa Capucino | pcs | SUGIONO, TLEKUNG, GENENGAN, DERMO, MANDALA, KALIURANG | _isi_ |
| Bahan Pentol Rangu | pcs / Rp | SUGIONO, TLEKUNG, GENENGAN | _isi_ |
| Adonan Leker | pcs / Rp | DERMO | _isi_ |
| Bahan Pentol Kecil Rangu | pcs / Rp | MANDALA | _isi_ |

Catatan `Adonan Leker` (DERMO): pembeliannya tercatat Rp10.000 sampai Rp1.000.000 per satuan sehingga saling bertentangan; satuan dan harga yang benar harus dari Bos Cyo.

## Yang sengaja tidak dikerjakan blok-blok ini

- **Jumlah stok yang salah catat** (mis. pembelian "1 pcs" untuk 1 kg gula, Air Mineral dengan jumlah janggal): koreksi harga tidak menyentuh stok. Perbaiki lewat Opname / Penyesuaian Stok.
- **Satuan Gula di MANDALA** tercatat `pcs` padahal gram. Harga di blok sudah per gram-setara (Rp17,67), jadi HPP sudah benar; mengganti label satuan sebaiknya dilakukan setelah Bos Cyo memastikan angka stoknya (ganti satuan hanya mengganti label, tidak mengonversi).
- **Pembelian bertanda janggal** yang HPP rata-ratanya sudah wajar hanya dilaporkan (`audit_hpp.notes`), tidak diubah.

## Akun selisih stok opname (keputusan Bos Cyo 2026-10-03)

- Selisih **kurang** (barang hilang): akun **Beban Kehilangan Barang**.
- Selisih **lebih** (barang bertambah): akun **Pendapatan Penambahan Barang**.
- Selisih uang laci saat tutup: belum diputuskan.

Keputusan ini sudah dicatat, tetapi **jurnal opname otomatis belum dibangun** (lihat `KNOWN_ISSUES.md`). Sampai dibangun, selisih opname belum masuk Laporan Untung Rugi dari pembukuan.

<!-- DOC-IMPACT: perbarui bila angka audit dihitung ulang, alat koreksi_hpp_banyak berubah, atau akun selisih opname diputuskan ulang. -->
