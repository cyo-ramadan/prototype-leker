# Lembar koreksi HPP — Genengan, Mandala, DERMO (2026-10-02)

Disusun Hana dari data produksi (hanya baca). Dijalankan lewat **Admin Gerai → Hitung Ulang HPP**
(`/api/admin/hpp-recalculation`, preview dulu baru terapkan) oleh Bos Cyo atau Una. Tidak ada INSERT
langsung ke database. Urutan wajib: **bahan baku dulu, baru larutan**, karena harga larutan dihitung dari
harga bahan bakunya.

## Akar masalah (terbukti dari riwayat pembelian)

Jumlah pembelian diisi dalam kemasan (2 galon, 1 kg) padahal satuan dasar barangnya ml / g. Harga satuan jadi
ribuan kali lipat, lalu meracuni produksi larutan berikutnya.

| Gerai | Barang | Tercatat | Seharusnya | Bukti |
|---|---|---|---|---|
| GENENGAN | Air Mineral, 26 Sep | qty 2, Rp16.000 | 32.000 ml (Rp0,5/ml) | tiga pembelian lain di gerai ini: 32.000 ml = Rp16.000 |
| GENENGAN | Gula, 26 Sep | qty 1, Rp19.000 | 1.000 g (Rp19/g) | pembelian lain Rp18,5 – 19/g |
| MANDALA | Air Mineral, 1 Okt | qty 2, Rp14.000 | 32.000 ml (Rp0,4375/ml) | pola 1 galon = 16.000 ml dari Genengan/Beji |
| MANDALA | Gula, 1 Okt (2 baris) | qty 1, Rp18.000 | 1.000 g per baris | pembelian 30 Sep: 2.000 = Rp35.000; satuan barang berlabel pcs padahal isinya gram |
| DERMO | Air Mineral, 29 Sep | qty 2, Rp12.000 | 32.000 ml (Rp0,375/ml) | pola yang sama |

Pola yang sama juga terlihat di BEJI (Air 24 Sep) dan PENDEM (Air/Gula 5 dan 17 Sep), tetapi harga rata-rata
kedua gerai itu sudah wajar karena pembelian besar lain mengimbangi.

## Langkah (isi: Bahan · Harga per satuan · Mulai tanggal · Alasan)

### GENENGAN
| # | Bahan | Harga (Rp) | Mulai | Catatan |
|---|---|---|---|---|
| 1 | Air Mineral (ml) | 0,5 | 2026-09-26 | hanya harga rata-rata; alasan: "Pembelian 26 Sep salah catat qty 2 seharusnya 32.000 ml" |
| 2 | Teh Vanilla (pcs) | 1500 | 2026-09-22 | hanya harga rata-rata; satu-satunya pembelian: 40 pcs = Rp60.000 |
| 3 | Teh Jasmine (pcs) | 1500 | 2026-09-22 | belum ada pembelian di gerai ini; ikut harga gerai normal (Pendem, Mandala) |
| 4 | Larutan Teh Poci Vanilla (ml) | 4,67 | 2026-09-22 | = (2.000×0,5 + 360×19 + 1×1.500) ÷ 2.000 |
| 5 | Larutan Teh Poci Jasmine (ml) | 4,67 | 2026-09-22 | resep sama |

Dampak tercatat sebelum koreksi: 114 + 82 penjualan, HPP larutan teh tercatat sekitar Rp195 juta.

### MANDALA
| # | Bahan | Harga (Rp) | Mulai | Catatan |
|---|---|---|---|---|
| 1 | Air Mineral (ml) | 0,4375 | 2026-10-01 | hanya harga rata-rata |
| 2 | Gula (pcs, sebenarnya gram) | 17,75 | 2026-09-30 | = (35.000 + 18.000 + 18.000) ÷ (2.000 + 1.000 + 1.000) |
| 3 | Teh Jasmine (pcs) | 1500 | 2026-09-29 | satu-satunya pembelian: 40 pcs = Rp60.000 |
| 4 | Teh Vanilla (pcs) | 1500 | 2026-09-29 | belum ada pembelian; ikut Genengan |
| 5 | Larutan Gula (ml) | 11,367188 | 2026-09-29 | = (100×0,4375 + 100×17,75) ÷ 160 |
| 6 | Larutan Teh Poci Jasmine (ml) | 1,1875 | 2026-09-29 | = (2.000×0,4375 + 1.500) ÷ 2.000 |
| 7 | Larutan Teh Poci Vanilla (ml) | 1,1875 | 2026-09-29 | resep sama |

Dampak sebelum koreksi: Larutan Gula tercatat Rp11.252/ml (HPP sekitar Rp18 juta untuk 58 penjualan).

### DERMO (menyusul, di luar dua gerai di atas)
Air Mineral Rp0,375/ml (harga rata-rata sekarang Rp1,99). Larutan DERMO perlu dicek terhadap resepnya sendiri
sebelum diubah (Larutan Gula tercatat Rp0,14/ml, terlalu rendah). Jangan disamakan dengan gerai lain.

## Yang tidak dibereskan alat ini
- **Jumlah stok** bahan yang salah catat masih kurang (mis. Air Mineral tercatat 2, seharusnya 32.000 ml).
  Selesaikan dengan Penyesuaian Stok / opname, terpisah dari HPP.
- Satuan Gula Mandala berlabel pcs; ganti ke g lewat Master Barang (Ganti Satuan, dengan konfirmasi).
- Harga di atas adalah turunan dari bukti pembelian, bukan tebakan. Dua asumsi yang diingat: 1 galon = 16.000 ml,
  dan harga Teh di gerai tanpa pembelian mengikuti Rp1.500 per pcs dari gerai yang punya pembelian.

## DOC-IMPACT
Perbarui kalau: koreksi dijalankan (catat tanggal dan hasil), atau bukti pembelian di atas berubah.
