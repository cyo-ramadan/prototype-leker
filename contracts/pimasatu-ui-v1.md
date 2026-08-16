# PIMASATU UI v1

`window.MAXIPimasatu.create(options)` adalah kontrak UI transaksi satu-per-satu.

Invariant: saat surface transaksi pertama kali tampil, composer dan kolom pencarian langsung terbuka tanpa tombol toggle; satu composer aktif; Qty default 1; pencarian harus memilih master valid; nominal auto-fill dari master; edit nominal dikontrol adapter; setelah tambah composer reset dan collapse; tombol Tambah hanya muncul ketika composer tertutup dan hanya membuka composer untuk item berikutnya; tombol tidak berubah menjadi Tutup; membuka composer tidak boleh auto-focus atau menampilkan pilihan sebelum user menyentuh/mengetik pada search; detail terbaru berada di atas; duplikat ditolak bila detail dikelola komponen; tidak ada pre-created empty slots. Pada transaksi kasir, surface PIMASATU dibuka sebagai modal transaksi dan tidak ditanam inline di bawah tombol navigasi.

Adapter wajib menyediakan `host`, `items`, identity/label mapper, default nominal, serta handler error. Gunakan `renderDetails:false` + `onAdd` bila domain sudah memiliki detail canonical sendiri. `initialExpanded` default `true`; adapter hanya boleh mengubahnya jika product decision secara eksplisit meminta composer tertutup saat landing.
