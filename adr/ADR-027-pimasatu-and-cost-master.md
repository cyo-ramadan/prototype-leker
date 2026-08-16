# ADR-027 — PIMASATU UI dan Master Biaya

## Keputusan

MAXI memakai **PIMASATU UI** (Pilih dan Masukkan Satu per Satu) sebagai komponen transaksi reusable. Pengguna membuka composer, mencari satu item, memakai Qty default 1, memeriksa/mengubah nominal bila flow mengizinkan, lalu memasukkannya. Composer dikosongkan dan ditutup; detail terbaru tampil paling atas. UI tidak boleh membuat banyak slot keranjang kosong terlebih dahulu.

Implementasi canonical berada di `public/pimasatu-ui.js` dan `public/pimasatu-ui.css`. Adapter flow hanya memasok data, label, harga default, permission edit harga, dan callback transaksi.

Master Biaya terpisah dari Master Barang. `cost_types` menghubungkan biaya ke rule Debit Operasional milik Accounting; POS tidak memilih akun debit/kredit sendiri. `cost_masters` menyimpan nama, kontak, biaya keluar, biaya masuk, jenis, kelompok, dan status per gerai.

Default operasional yang belum dikonfigurasi memakai Debit `6101 Beban Operasional`; sisi Kredit tetap diselesaikan dari Cara Bayar oleh Accounting. Admin dapat mengganti komponen lewat konfigurasi Accounting.

## Konsekuensi

- Penjualan memakai harga jual master read-only.
- Pembelian memakai harga beli master sebagai default editable.
- Operasional memakai biaya keluar master sebagai default editable.
- Detail baru memakai urutan newest-first.
- Jenis Barang tidak dipakai ulang sebagai Jenis Biaya.
