# PIMASATU UI v1

`window.MAXIPimasatu.create(options)` adalah kontrak UI transaksi satu-per-satu.

## Boundary

PIMASATU hanya mengatur **format interaksi UI/UX** untuk memilih dan memasukkan item/variabel satu per satu. PIMASATU tidak memiliki ownership atas modul bisnis, supplier/customer/contact, metode pembayaran, Inventory, Accounting, journal mapping, atau persistence transaksi.

Adapter/domain host tetap bertanggung jawab menentukan data apa yang ditampilkan, payload transaksi, permission, validation, dan integrasi modul. Field domain seperti supplier/customer/contact dan cara bayar berada di luar komponen PIMASATU walaupun tampil dalam modal transaksi yang sama.

## Invariant

Saat surface transaksi pertama kali tampil, composer dan kolom pencarian langsung terbuka tanpa tombol toggle; satu composer aktif; Qty default 1; pencarian harus memilih master valid; nominal auto-fill dari master; edit nominal dikontrol adapter; setelah tambah composer di-reset dan tetap terbuka untuk item berikutnya sehingga tombol `+ Tambah` tidak muncul di antara input item; membuka composer tidak boleh auto-focus atau menampilkan pilihan sebelum user menyentuh/mengetik pada search; detail terbaru berada di atas; duplikat ditolak bila detail dikelola komponen; tidak ada pre-created empty slots. Pada transaksi kasir, surface PIMASATU dibuka sebagai modal transaksi dan tidak ditanam inline di bawah tombol navigasi.

Untuk transaction composition yang memakai counterpart/payment, urutan visual canonical adalah: **PIMASATU item/variabel → counterpart terkait (customer/supplier/contact bila ada) → metode pembayaran → field transaksi tambahan/summary/action**. Counterpart dan payment tetap dimiliki layer transaksi, bukan PIMASATU.

Adapter wajib menyediakan `host`, `items`, identity/label mapper, default nominal, serta handler error. Gunakan `renderDetails:false` + `onAdd` bila domain sudah memiliki detail canonical sendiri. `initialExpanded` default `true`; adapter hanya boleh mengubahnya jika product decision secara eksplisit meminta composer tertutup saat landing.

## DOC-IMPACT

REQUIRED — boundary UI-only dan transaction composition diperjelas agar PIMASATU tidak menjadi source of truth domain atau integration layer.
