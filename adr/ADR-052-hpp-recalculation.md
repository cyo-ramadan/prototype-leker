# ADR-052 — Hitung Ulang HPP: koreksi harga bahan, hanya HPP

Status: ACCEPTED (Bos Cyo, 2026-10-02: "kalo leker itu harganya 2000 maka bahannya 2000
adonan ... 1 adonan itu 1 rupiah ... bisa dibenerin pake hitung ulang? kalo bisa jadikan itu
fitur ... hanya berlaku untuk hpp")
Tanggal: 2026-10-02
Ditulis oleh: Hana

## Konteks

Harga rata-rata bahan bisa salah karena salah input pembelian (contoh produksi: DERMO "Adonan
Leker" tercatat 1 satuan seharga Rp10.000/Rp186.000/Rp100.000, padahal satuannya Rupiah; harga
rata-rata naik jadi Rp1.092 per satuan, HPP Leker Rp2.000 jadi Rp2,18 juta). Snapshot HPP
penjualan dan jurnalnya immutable (invariant #2), jadi perbaikannya harus berupa koreksi baru.

## Keputusan

1. Admin Gerai/Owner memilih **satu bahan**, mengisi **harga per satuan yang benar** dan
   **tanggal mulai**, melihat **pratinjau** (HPP lama vs baru per hari), lalu **Terapkan**
   dengan alasan wajib.
2. Yang dihitung ulang: biaya bahan itu di **produksi dadakan** yang menempel ke penjualan yang
   tidak dibatalkan. Selisih disimpan per baris penjualan (`hpp_recalculation_lines`). Biaya
   lama = snapshot + koreksi sebelumnya, jadi hitung ulang berulang tidak menggandakan.
3. **Hanya HPP.** Jumlah stok, nominal pembelian, uang laci, dan snapshot lama tidak ditulis
   ulang. Harga rata-rata bahan diganti ke harga benar supaya penjualan berikutnya benar.
4. Laporan: mesin fakta POS menjumlahkan selisih ke HPP per tanggal penjualan (cache tanggal itu
   dibuang). Gerai Akuntansi menerima **jurnal koreksi per penjualan** (Debit Persediaan bahan /
   Kredit HPP barang terjual bila HPP terlalu besar; kebalikannya bila terlalu kecil), hanya
   setelah jurnal penjualannya POSTED; sisanya diposting lewat tombol sinkron Akuntansi.
   Dicatat di `accounting_bridge_deliveries` (fakta `HPP_KOREKSI`), tanpa foreign key dari
   tabel koreksi ke jurnal (invariant #4).
5. Produksi **manual (stok)** yang memakai bahan itu tidak ikut dihitung ulang; jumlahnya
   ditampilkan di pratinjau.

## Konsekuensi

- Leker titipan (1 adonan = Rp1, adonan = harga jual) setelah dihitung ulang: untung nol.
- Pembelian yang nominalnya salah (mis. DERMO Rp1 milyar dan Rp100 juta) tetap tercatat; itu
  koreksi pembelian, bukan HPP, dan belum dikerjakan.
- Rantai bahan setengah jadi (Air → Larutan → Es Teh) dikoreksi dengan memilih bahan yang
  langsung dipakai produksi dadakan (Larutan), bukan bahan di hulunya.

<!-- DOC-IMPACT: 2026-10-02 ADR baru; migration 0134; src/hpp-recalculation.js; public/admin-hpp-recalc.js. -->
