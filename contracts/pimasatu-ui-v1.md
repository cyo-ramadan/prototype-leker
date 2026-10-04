# PIMASATU UI v1

`window.MAXIPimasatu.create(options)` adalah kontrak UI transaksi satu-per-satu.

## Boundary

PIMASATU hanya mengatur **format interaksi UI/UX** untuk memilih dan memasukkan item/variabel satu per satu. PIMASATU tidak memiliki ownership atas modul bisnis, supplier/customer/contact, metode pembayaran, Inventory, Accounting, journal mapping, API module, atau persistence transaksi.

Adapter/domain host tetap bertanggung jawab menentukan data apa yang ditampilkan, payload transaksi, permission, validation, dan integrasi modul. Field domain di luar item composer tidak menjadi bagian dari kontrak PIMASATU walaupun tampil pada layar atau modal yang sama.

## Invariant

Saat surface PIMASATU pertama kali tampil, composer dan kolom pencarian langsung terbuka tanpa tombol toggle; satu composer aktif; Qty default 1; pencarian harus memilih master valid; nominal auto-fill dari master; edit nominal dikontrol adapter; setelah tambah composer di-reset dan tetap terbuka untuk item berikutnya sehingga tombol `+ Tambah` tidak muncul di antara input item; membuka composer tidak boleh auto-focus atau menampilkan pilihan sebelum user menyentuh/mengetik pada search; detail terbaru berada di atas; duplikat ditolak bila detail dikelola komponen; tidak ada pre-created empty slots.

Adapter wajib menyediakan `host`, `items`, identity/label mapper, default nominal, serta handler error. Gunakan `renderDetails:false` + `onAdd` bila domain sudah memiliki detail canonical sendiri. `initialExpanded` default `true`; adapter hanya boleh mengubahnya jika product decision secara eksplisit meminta composer tertutup saat landing.

## Explicitly Out of Scope

- urutan field transaction modal di luar item composer;
- customer, supplier, contact, atau counterpart lain;
- metode pembayaran atau settlement;
- Accounting / Setting Akuntansi;
- Inventory semantics;
- API transport dan persistence transaksi.

## Aturan isian angka (2026-10-04, versi 1.5.0)

Keputusan Bos Cyo: kasir tertukar titik dan koma sehingga HPP kacau. Qty, harga, dan total
di PIMASATU memakai `public/angka-input.js` (`window.MAXIAngka`):

- Titik tidak bisa diketik; titik yang terlihat selalu pemisah ribuan buatan program.
- Koma = desimal, hanya di harga per satuan mode `toggle` (Beli Bahan). Qty dan total hanya bulat.
- Tempelan bertitik dibaca ribuan (`1.500` = 1500), jadi `1.500` tidak pernah jadi 1,5 dan qty
  `1.000` gram tidak pernah jadi 1 gram.
- Halaman yang memuat PIMASATU wajib memuat `angka-input.js` lebih dulu. Tanpa itu PIMASATU tetap
  membaca dengan aturan yang sama (titik dibuang, koma = desimal), hanya tanpa format otomatis.
- Belum dipasang di isian angka di luar PIMASATU (produksi, penyesuaian stok, opname).

## DOC-IMPACT

REQUIRED — PIMASATU ditegaskan sebagai kontrak UI/UX item composer saja, tanpa transaction/module ownership.
