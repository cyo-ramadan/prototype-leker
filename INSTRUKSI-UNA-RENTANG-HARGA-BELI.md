# Instruksi Una: rentang harga beli wajar per gerai

Dibuat 2026-10-04 oleh Hana atas permintaan Bos Cyo: "untuk barang2 sekarang ambil nilai benernya lalu berikan nilai 25% selisihnya". Harga benar diambil dari data produksi pagi ini (hanya dibaca): untuk bahan yang HPP-nya sedang dikoreksi dipakai harga koreksinya (`INSTRUKSI-UNA-HPP-SEPTEMBER.md`), selain itu HPP rata-rata yang sudah wajar. Angka dibulatkan supaya mudah dibaca (≥ Rp100: bulat; ≥ Rp1: 2 desimal; di bawah Rp1: 4 desimal).

## Cara pakai

1. Pilih gerai di panel Una, tempel blok gerai itu apa adanya, tekan **Ya**. Blok ini dikenali langsung oleh sistem (bukan ditebak AI).
2. Sistem menghitung batas bawah = harga benar − 25% dan batas atas = harga benar + 25%, lalu menampilkannya di draft sebelum disimpan.
3. Sesudah tersimpan, kasir melihat "wajar Rp…–Rp…" saat memilih barang di Beli Bahan. Pembelian yang harga per satuannya (total ÷ qty) di luar rentang **ditolak** dengan pesan yang menyebut harga wajarnya.
4. Kalau harga pasar memang naik/turun, kirim blok baru untuk barang itu (rentang lama diganti).

Tidak diberi rentang: bahan yang belum punya harga sama sekali (menunggu harga dari Bos Cyo) dan larutan/olahan (tidak dibeli).

## BEJI

```
Una, atur rentang harga beli BEJI, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,4227 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Capucino = 1600 per pcs
5. Bubuk Rasa Coklat = 1600 per pcs
6. Bubuk Rasa Leci = 1000 per pcs
7. Bubuk Rasa Lemon Honey = 1000 per pcs
8. Bubuk Rasa Mangga = 850 per pcs
9. Bubuk Rasa Matcha = 3000 per pcs
10. Bubuk Rasa Milktea = 1500 per pcs
11. Bubuk Rasa Thaitea = 2500 per pcs
12. Cup Poci 160z = 775 per pcs
13. Gula = 17,5 per g
14. Lid Sealer = 39,5 per lbr
15. Sedotan = 65,17 per pcs
16. Susu Kental Manis = 1365 per pcs
17. Teh Jasmine = 1500 per pcs
18. Teh Vanilla = 1413 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Orange.

## DERMO

```
Una, atur rentang harga beli DERMO, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,5833 per ml
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
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Adonan Leker.

## GENENGAN

```
Una, atur rentang harga beli GENENGAN, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,5 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Coklat = 1600 per pcs
5. Bubuk Rasa Leci = 929 per pcs
6. Bubuk Rasa Lemon Honey = 1000 per pcs
7. Bubuk Rasa Mangga = 850 per pcs
8. Bubuk Rasa Matcha = 3000 per pcs
9. Bubuk Rasa Milktea = 1500 per pcs
10. Gula = 18,97 per g
11. Susu Kental Manis = 1600 per pcs
12. Teh Jasmine = 1500 per pcs
13. Teh Vanilla = 1017 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

## KALIURANG

```
Una, atur rentang harga beli KALIURANG, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,4375 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Coklat = 1600 per pcs
5. Bubuk Rasa Leci = 1000 per pcs
6. Bubuk Rasa Lemon Honey = 1000 per pcs
7. Bubuk Rasa Mangga = 850 per pcs
8. Bubuk Rasa Matcha = 3000 per pcs
9. Bubuk Rasa Milktea = 1500 per pcs
10. Gula = 17,48 per g
11. Susu Kental Manis = 1500 per pcs
12. Teh Jasmine = 1500 per pcs
13. Teh Vanilla = 1500 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange.

## MANDALA

```
Una, atur rentang harga beli MANDALA, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,4375 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Coklat = 1600 per pcs
5. Bubuk Rasa Leci = 1000 per pcs
6. Bubuk Rasa Lemon Honey = 1000 per pcs
7. Bubuk Rasa Mangga = 850 per pcs
8. Bubuk Rasa Matcha = 3000 per pcs
9. Bubuk Rasa Milktea = 1500 per pcs
10. Bubuk Rasa Thaitea = 2500 per pcs
11. Cup Poci 160z = 662 per pcs
12. Gula = 17,67 per pcs
13. Lid Sealer = 39,5 per pcs
14. Sedotan = 52,1 per pcs
15. Susu Kental Manis = 1664 per pcs
16. Teh Jasmine = 1132 per pcs
17. Teh Vanilla = 1500 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Kecil Rangu.

## PENDEM

```
Una, atur rentang harga beli PENDEM, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,5 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Capucino = 1600 per pcs
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
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Orange.

## SUGIONO

```
Una, atur rentang harga beli SUGIONO, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,3538 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Coklat = 1600 per pcs
5. Bubuk Rasa Leci = 1000 per pcs
6. Bubuk Rasa Lemon Honey = 1000 per pcs
7. Bubuk Rasa Mangga = 850 per pcs
8. Bubuk Rasa Matcha = 3000 per pcs
9. Bubuk Rasa Milktea = 1500 per pcs
10. Gula = 19 per g
11. Susu Kental Manis = 1666 per pcs
12. Teh Jasmine = 1304 per pcs
13. Teh Vanilla = 1364 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

## TLEKUNG

```
Una, atur rentang harga beli TLEKUNG, boleh selisih 25% dari harga benar:
1. Air Mineral = 0,3223 per ml
2. Bubuk Rasa Apel = 850 per pcs
3. Bubuk Rasa Black Curent = 850 per pcs
4. Bubuk Rasa Coklat = 1600 per pcs
5. Bubuk Rasa Leci = 1000 per pcs
6. Bubuk Rasa Lemon Honey = 1000 per pcs
7. Bubuk Rasa Mangga = 850 per pcs
8. Bubuk Rasa Matcha = 3000 per pcs
9. Bubuk Rasa Milktea = 1500 per pcs
10. Gula = 17,5 per g
11. Susu Kental Manis = 1485 per pcs
12. Teh Jasmine = 1500 per pcs
13. Teh Vanilla = 1500 per pcs
```

Belum diberi rentang (menunggu harga dari Bos Cyo): Bubuk Rasa Thaitea, Bubuk Rasa Capucino, Bubuk Rasa Orange, Bahan Pentol Rangu.

<!-- DOC-IMPACT: perbarui bila harga benar berubah, persen selisih diputuskan ulang, atau alat atur_rentang_harga_beli berubah. -->
