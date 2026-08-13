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

**Pitfall:** Jangan menyimpan atau menghitung authoritative Average Cost, Harga Beli Terakhir, sale COGS, atau production HPP baru menggunakan SQLite `REAL`, JavaScript floating-point sebagai source of truth, atau SQL `* 1.0`.

**Current strategy:**

- current exact cost scale = `1,000,000` cost units per rupiah;
- authoritative new cost fields are scaled INTEGER;
- UI/API converts scaled values only for presentation;
- legacy production REAL fields from migration 0017 are history fallback only and new writers leave them NULL.

## Qty operasional bukan stock movement

**Pitfall:** Jangan menganggap `expenses.quantity` sebagai inventory consumption hanya karena user mengisi Qty pada Pengeluaran Operasional.

Qty tersebut adalah customer-behaviour metadata. Inventory moves only through an explicit inventory-owned movement contract. Jika suatu operasional memang memakai barang stok, link ke inventory must be an explicit future flow rather than inferred from description or quantity.

## Transaction explorer bukan source of truth

**Pitfall:** Jangan menulis ulang transaksi melalui Admin Transaction Explorer atau menjadikannya ledger kedua.

Explorer hanya read model dengan `sourceReference`. Perubahan transaksi tetap harus lewat module pemilik business fact. Detail jurnal juga tidak boleh dipindahkan ke Admin.

## Journal Rules bukan journal-generation engine

**Pitfall:** Status `Lengkap` pada `transaction_categories` tidak berarti transaksi boleh langsung dibuatkan jurnal.

`Lengkap` hanya membuktikan ada minimal satu Debit dan satu Kredit aktif. Future posting masih wajib resolve payment method aktual, Jenis Barang transaksi, amount, direction/subtype, period, tenant/store context, idempotency, dan contract Accounting. Jangan membuat fallback account ketika source rule tidak bisa di-resolve.

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

## Accounting tetap owner posting jurnal

Prototype Leker boleh menyimpan Settings dan business facts. Ia tidak boleh menulis langsung ke database Accounting, membuat General Ledger tandingan, atau menganggap journal preview sebagai posted journal.

## DOC-IMPACT

**REQUIRED** — refresh kasir tetap event-driven, costing memakai exact scaled integer snapshots, operational Qty tidak bocor menjadi stock movement, Accounting Settings tetap configuration-only, Warehouse tidak memiliki duplicate mapping, dan journal generation tetap boundary terpisah.
