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

## Accounting reference bukan COA/jurnal source of truth

**Pitfall:** Jangan memperlakukan `accounting_account_refs` sebagai Chart of Accounts canonical atau menghasilkan debit/kredit langsung dari reference ini.

Reference `1101`, `1301`, `4101`, `5101`, dan akun dasar lain hanya placeholder connector berstatus `PROVISIONAL` sampai modul Accounting memberikan external account identity yang canonical.

**Current strategy:**

- Admin boleh menampilkan Portal Referensi Akun dan menyimpan explicit product reference.
- Tidak ada account mapping yang dipilih otomatis hanya karena kode akun dasar tersedia.
- Mapping transaksi ditambahkan satu per satu melalui contract berikutnya.
- Journal, buku besar, neraca saldo, neraca, laba rugi, dan closing tetap dimiliki modul Accounting.
- Program lain tidak menulis langsung ke database Accounting.

## DOC-IMPACT

**REQUIRED** — refresh kasir tetap event-driven, costing memakai exact scaled integer snapshots, operational Qty tidak bocor menjadi stock movement, Transaction Explorer tetap read model, dan Accounting reference tetap connector-only.
