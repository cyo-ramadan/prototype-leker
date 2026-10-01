# ADR-050 — Resep Entity: template milik Entity, diterapkan ke resep gerai

Status: ACCEPTED (arah diputuskan Bos Cyo 2026-10-01 "resep di taruh entity aja, biar
ga ngerjain satu2 per gerai"; "resep variant dilanjut")
Tanggal: 2026-10-01
Ditulis oleh: Hana
Melengkapi: ADR-043 (resep eksekusi tetap store-scoped), `contracts/manufacturing-master-v1.md`

## Masalah

Satu menu (mis. Es Teh Jasmine) punya dua resep (resep 1 larutan tawar + larutan gula + cup,
resep 2 larutan manis + cup). Dengan 14 gerai, mengisi dua resep itu satu per satu per gerai
memakan waktu dan gampang beda-beda. ADR-043 sengaja menyisakan resep Entity sebagai
**acuan teks** saja; resep yang memotong stok tetap milik gerai.

## Keputusan

1. **Template resep dimiliki Entity** (`entity_recipe_templates` + komponen), dirujuk lewat
   **Kode Barang** (`product_masters`): hasil dan bahan sama-sama Kode Barang, bukan id barang
   gerai. Mendukung banyak varian per Kode Barang hasil (label varian sama seperti resep gerai).
2. **Template tidak pernah dieksekusi.** Ia "diterapkan" ke gerai: sistem membuat revisi
   `manufacturing_recipes` baru milik gerai itu lewat jalur yang sama dengan Master Resep
   gerai (validasi tipe barang, siklus BOM, qty bulat, satu ACTIVE per varian). ADR-043 tidak
   berubah: yang memotong stok tetap resep gerai.
3. **Penerapan eksplisit, bukan otomatis.** Admin Entity/Owner melihat **pratinjau per gerai**
   (siap / sudah terbaru / akan menggantikan resep aktif / terblokir + alasan), lalu memilih
   gerai mana yang diterapkan. Mengubah template tidak mengubah resep gerai mana pun sampai
   diterapkan.
4. **Fail-closed per gerai**: terblokir bila barang hasil/bahan belum diaktifkan di gerai itu,
   ada dua barang aktif untuk Kode Barang yang sama, atau satuan dasar barang gerai berbeda
   dengan satuan di template (angka resep tidak akan dikonversi diam-diam). Satu gerai
   terblokir tidak menggagalkan gerai lain.
5. **Riwayat tidak ditulis ulang.** Penerapan = revisi baru; revisi lama gerai di-ARCHIVE.
   Bila barang gerai menunjuk resep yang digantikan, penunjuknya dipindah ke revisi baru dalam
   batch yang sama (penunjuk tidak pernah dibuat dari nol oleh penerapan).
6. **Jejak**: `entity_recipe_applications` mencatat revisi template mana terpasang di gerai mana
   dan menjadi resep yang mana.
7. Hanya **Owner / Entity Admin** yang boleh membuat/mengubah template dan menerapkan.
   Admin Gerai tetap boleh mengubah resep gerainya sendiri; penerapan berikutnya akan
   menggantikannya dengan revisi baru (yang lama tetap ada di arsip) dan pratinjau
   memperingatkannya.

## Konsekuensi

- Pemilik cukup mengisi dua resep sekali; menerapkan ke gerai yang barangnya sudah aktif
  adalah satu klik.
- Gerai yang belum mengaktifkan bahan harus mengaktifkannya dulu; pratinjau menyebut barang
  mana yang kurang.
- Perubahan resep di Entity tidak "mengejar" gerai otomatis; pratinjau menandai gerai yang
  belum memakai revisi terbaru.

<!-- DOC-IMPACT: 2026-10-01 ADR baru; migration 0131; src/entity-recipe.js. -->
