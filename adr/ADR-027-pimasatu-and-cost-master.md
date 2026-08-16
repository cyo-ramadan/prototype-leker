# ADR-027 — PIMASATU UI dan Master Biaya

## Keputusan

MAXI memakai **PIMASATU UI** (Pilih dan Masukkan Satu per Satu) sebagai komponen reusable untuk format interaksi transaksi. PIMASATU adalah layer UI/UX saja: ia mengatur pola memilih item/variabel, Qty, nominal, memasukkan item, reset composer, dan detail newest-first. PIMASATU tidak memiliki ownership atas supplier/customer/contact, cara bayar, Inventory, Accounting, mapping jurnal, API module, atau persistence transaksi.

Saat surface transaksi pertama kali tampil, composer dan kolom pencarian langsung terbuka tanpa tombol toggle. Pengguna mencari satu item, memakai Qty default 1, memeriksa/mengubah nominal bila flow mengizinkan, lalu memasukkannya. Setelah item masuk, composer dikosongkan dan tetap terbuka untuk input berikutnya; tombol `+ Tambah` tidak muncul sebagai langkah pembuka ulang di antara item. Membuka composer tidak memunculkan pilihan sampai user menyentuh atau mengetik pada search. Detail terbaru tampil paling atas. UI tidak boleh membuat banyak slot keranjang kosong terlebih dahulu. Pada transaksi kasir, adapter membuka surface ini sebagai modal transaksi, bukan panel inline di bawah tombol navigasi.

Implementasi canonical berada di `public/pimasatu-ui.js` dan `public/pimasatu-ui.css`. Adapter flow hanya memasok data, label, harga default, permission edit harga, dan callback UI. Domain host menyusun field lain di luar PIMASATU.

Untuk modal transaksi yang memiliki counterpart dan settlement, susunan visual canonical adalah:

1. PIMASATU item/variabel;
2. counterpart yang relevan, misalnya customer, supplier, atau contact;
3. metode pembayaran;
4. field transaksi tambahan, summary, dan action.

Urutan tersebut adalah keputusan composition UI. Counterpart, payment, dan integration semantics tetap milik layer transaksi masing-masing.

Master Biaya terpisah dari Master Barang. `cost_types` menghubungkan biaya ke rule Debit Operasional milik Accounting; POS tidak memilih akun debit/kredit sendiri. `cost_masters` menyimpan nama, kontak, biaya keluar, biaya masuk, jenis, kelompok, dan status per gerai.

Default operasional yang belum dikonfigurasi memakai Debit `6101 Beban Operasional`; sisi Kredit tetap diselesaikan dari Cara Bayar oleh Accounting. Admin dapat mengganti komponen lewat konfigurasi Accounting.

## Konsekuensi

- Penjualan memakai harga jual master read-only.
- Pembelian memakai harga beli master sebagai default editable.
- Operasional memakai biaya keluar master sebagai default editable.
- Detail baru memakai urutan newest-first.
- Jenis Barang tidak dipakai ulang sebagai Jenis Biaya.
- PIMASATU tidak boleh berkembang menjadi source of truth domain atau integration layer.

## DOC-IMPACT

REQUIRED — boundary PIMASATU diperjelas menjadi UI-only dan composition order modal transaksi ditetapkan.
