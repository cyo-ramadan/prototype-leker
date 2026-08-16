# Known Pitfalls — Prototype Leker

## Periodic cashier polling

**Pitfall:** Jangan menjalankan polling periodik untuk queue order dan status laci pada prototype ini.

Polling beberapa detik sekali dari setiap tab kasir membuat request Worker/D1 bertambah terus walaupun tidak ada perubahan. Membuka lebih dari satu tab menggandakan traffic tersebut dan dapat memperburuk error quota/network tanpa memberi nilai operasional yang sebanding.

**Current strategy:**

- Dashboard kasir memuat menu, order, dan status laci saat dibuka.
- Tidak ada periodic `setInterval` refresh yang aktif.
- Kasir mempunyai tombol **Refresh Pesanan** untuk refresh manual.
- Order dan status laci direfresh ketika tab kembali visible atau window kembali focus.
- Action kasir yang mengubah state tetap memperbarui state terkait setelah request selesai.
- Error network/quota tidak boleh dianggap sebagai session expiry. Session hanya dilepas pada response auth yang benar-benar menyatakan session tidak valid.

Jika realtime otomatis dibutuhkan nanti, gunakan mekanisme push yang disetujui dan diuji, misalnya WebSocket/SSE, bukan mengembalikan polling rapat tanpa impact assessment.

## Recipe bukan HPP final

**Pitfall:** Jangan menghitung HPP manufaktur hanya dari recipe aktif dikali `products.purchase_price` terbaru.

Cara itu merusak historical costing karena harga bahan dapat berubah setelah produksi terjadi, recipe dapat mempunyai revision baru, dan actual consumption/yield dapat berbeda dari standar recipe.

**Current strategy:**

- Recipe/BOM disimpan sebagai immutable revision.
- Production snapshots exact scaled component cost and production-run HPP when posting.
- Inventory/Costing memiliki ownership valuation.
- Accounting memiliki ownership journal interpretation dan financial statements.

## HPP tidak boleh kembali ke REAL/FLOAT

**Pitfall:** Jangan menyimpan atau menghitung authoritative Average Cost, Harga Beli Terakhir, sale COGS, production HPP, atau journal amount baru menggunakan SQLite `REAL`, JavaScript floating-point sebagai source of truth, atau SQL `* 1.0`.

**Current strategy:**

- current exact cost and Accounting journal scale = `1,000,000` units per rupiah;
- authoritative new cost/journal fields are scaled INTEGER;
- Accounting accepts maximum 6 fractional decimal places and rounds half-up at digit 7;
- UI/API converts scaled values only for presentation;
- legacy production REAL fields from migration 0017 are history fallback only and new writers leave them NULL.

## Saldo negatif bukan jurnal tidak balance

**Pitfall:** Jangan mengubah saldo akun negatif menjadi positif memakai `abs()` hanya supaya UI terlihat rapi, dan jangan menganggap saldo negatif otomatis berarti jurnal invalid.

**Current strategy:**

- journal-line amount tetap positif dengan sisi `DEBIT`/`CREDIT` explicit;
- integrity posting = total Debit dan total Credit balance sesuai policy;
- General Ledger / Rugi Laba / Neraca mempertahankan sign saldo akun;
- investigasi saldo negatif dilakukan sebagai business/accounting review, bukan disamarkan oleh formatter.

## Toleransi Penyesuaian bukan karpet error

**Pitfall:** Jangan memakai akun `Penyesuaian` untuk membuat semua jurnal yang salah menjadi balance.

**Current strategy:**

- hanya command non-manual yang explicit meminta `AUTO_EQUITY_UP_TO_100_RUPIAH` yang boleh auto-adjust;
- maximum difference = `Rp100.000000`;
- difference lebih besar harus fail closed;
- manual journal wajib balance exact;
- line otomatis ditandai system-generated dan masuk dedicated Equity `Penyesuaian`, bukan akun Modal utama.

## Stok minus tidak boleh diam-diam diserap HPP baru

**Pitfall:** Kalau balance stok sudah negatif karena anomaly/history, jangan menganggap purchase baru otomatis memperbaiki integritas costing.

Current purchase logic mempunyai compatibility behavior saat stok `<= 0` yang dapat memakai unit cost pembelian terbaru sebagai baseline Average Cost. Policy store-level yang direncanakan akan dapat memblok purchase ketika current stock `< 0` supaya anomaly diperbaiki dulu.

**Guard:** jangan mengaktifkan policy blok tersebut sebelum Penyesuaian Stok write flow tersedia. Kalau tidak, item minus dapat terkunci: purchase ditolak tetapi user tidak punya approved path untuk mengoreksi saldo.

Ownership policy tetap Inventory/Costing, walaupun toggle boleh surfaced dari shared Settings UI.

## Qty operasional bukan stock movement

**Pitfall:** Jangan menganggap `expenses.quantity` sebagai inventory consumption hanya karena user mengisi Qty pada Pengeluaran Operasional.

Qty tersebut adalah customer-behaviour metadata. Inventory moves only through an explicit inventory-owned movement contract. Jika suatu operasional memang memakai barang stok, link ke inventory must be an explicit future flow rather than inferred from description or quantity.

## Transaction explorer bukan source of truth

**Pitfall:** Jangan menulis ulang transaksi melalui Admin Transaction Explorer atau menjadikannya ledger kedua.

Explorer hanya read model dengan `sourceReference`. Perubahan transaksi tetap harus lewat module pemilik business fact. Detail jurnal juga tidak boleh dipindahkan ke Admin.

## Journal Rules bukan journal-generation engine

**Pitfall:** Status `Lengkap` pada `transaction_categories` tidak berarti transaksi boleh langsung dibuatkan jurnal.

`Lengkap` hanya membuktikan ada minimal satu Debit dan satu Kredit aktif. Posting masih wajib resolve payment method aktual, Jenis Barang transaksi, amount, direction/subtype, period, tenant/store context, idempotency, dan contract Accounting. Jangan membuat fallback account ketika source rule tidak bisa di-resolve.

## Warehouse tidak boleh punya mapping akun tandingan

**Pitfall:** Jangan membuat `warehouse_account_mapping`, account dropdown di Warehouse Settings, atau hardcoded akun di kode Warehouse.

Warehouse mendaftarkan financially-relevant transaction types ke `transaction_categories` milik Accounting Settings. Akun/rule kemudian dikonfigurasi dari Module A. Ini mencegah dua source of truth yang bisa menghasilkan interpretasi jurnal berbeda.

## Stock Opname tidak boleh menjalankan semua default rules

**Pitfall:** `wh_opname` memiliki labeled gain dan loss rows. Future journal engine tidak boleh mengeksekusi keempat row sekaligus.

Signed stock adjustment harus menentukan branch gain atau loss secara explicit. `4201 Pendapatan Koreksi Stok` dan `6103 Beban Susut Persediaan` juga tetap berstatus `review_required` sampai pemilik bisnis menyetujui penggunaannya.

## Retur harus fail-closed sampai arah transaksi jelas

**Pitfall:** Jangan menggunakan satu jurnal default untuk semua `wh_return`.

Customer return, supplier return, dan internal return dapat mempunyai arah inventory/settlement berbeda. `wh_return` sengaja terdaftar tanpa journal rule sampai subtype/direction disepakati.

## Legacy pair mapping tidak boleh hidup kembali

**Pitfall:** Jangan menghidupkan kembali `accounting_account_refs` + `transaction_accounting_mappings` sebagai engine paralel terhadap `chart_of_accounts` + `journal_rules`.

Compatibility endpoint pair-mapping sudah dipensiunkan. Semua konfigurasi baru memakai `MAXI_ACCOUNTING_SETTINGS_V1`, sedangkan `transaction_accounting_snapshots` hanya menyimpan readiness evidence dan tidak berisi pasangan debit/kredit palsu.

## Migration ledger tidak membuktikan schema object lengkap

**Pitfall:** Jangan menganggap row pada tabel migration D1 otomatis membuktikan semua table/index/trigger yang pernah didefinisikan migration tersebut masih ada di remote database.

Insiden deployment Accounting 2026-08-13 membuktikan remote D1 dapat mempunyai migration ledger yang menyatakan `0018` sudah applied sementara dua compatibility table dari migration itu tidak ada. Migration `0023` kemudian gagal saat mencoba mengubah object yang hilang.

**Current recovery discipline:**

- ketika remote migration gagal karena missing/shape-mismatched object, inspect `d1 migrations list`, `sqlite_schema`, dan `PRAGMA table_info(...)` sebelum mengubah source migration;
- jangan rewrite migration yang sudah pernah dianggap applied hanya untuk membuat deploy hijau;
- capture D1 Time Travel checkpoint atau approved backup sebelum production repair;
- repair hanya object yang terbukti hilang menggunakan definisi authoritative dari migration/versioned contract yang bersangkutan;
- buat repair idempotent dan scoped, lalu resume canonical repository migration chain;
- setelah recovery, restore normal repository-owned deploy command dan buktikan fresh Git Integration deploy berhasil tanpa recovery script;
- temporary diagnostic assets/script harus dihapus dan live smoke harus membuktikan asset tersebut tidak lagi public.

## Accounting tetap owner posting jurnal

## Dialog transaksi jangan melakukan fetch berantai atau ganda

**Pitfall:** membuka Beli Bahan dengan fetch barang lalu supplier secara serial, kemudian editor meminta barang lagi, membuat dialog terasa lebih lambat daripada Operasional.

Fetch independen harus paralel, hasilnya dibagi melalui cache satu sesi, dan boleh diprefetch setelah workspace kasir siap. Gunakan PIMASATU untuk input satu-per-satu; jangan membuat slot keranjang kosong.

## D1 default bootstrap tidak boleh overlap dengan editor reads

**Pitfall:** Jangan menjalankan helper yang dapat menulis default reference dalam `Promise.all` yang sama dengan query snapshot editor.

Selesaikan bootstrap/default write terlebih dahulu, kemudian jalankan independent read queries secara paralel. Overlap batch write + read pada request yang sama dapat membuat endpoint gabungan gagal walaupun endpoint reference individual tetap sehat.

## Accounting tetap owner posting jurnal

Prototype Leker boleh menyimpan Settings dan business facts. POS/Warehouse tidak boleh menulis langsung ke database Accounting atau membuat General Ledger tandingan. Dalam local composition host, semua journal write tetap wajib melalui Accounting posting entry point yang sama.

## DOC-IMPACT

**REQUIRED** — refresh kasir tetap event-driven, costing/journal memakai exact scaled integer snapshots, saldo negatif dipertahankan sebagai signed balance, auto Penyesuaian dibatasi policy, operational Qty tidak bocor menjadi stock movement, Accounting Settings tetap configuration-only, Warehouse tidak memiliki duplicate mapping, stock-integrity policy tetap milik Inventory/Costing, dan production D1 recovery harus memverifikasi schema object—bukan hanya migration ledger.
