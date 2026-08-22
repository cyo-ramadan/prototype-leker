# Accounting Settings Contract v1

Status: ACTIVE for Prototype Leker draft implementation
Contract: `MAXI_ACCOUNTING_SETTINGS_V1`

## Purpose

Setting Akuntansi adalah registry konfigurasi untuk menghubungkan transaksi operasional, Jenis Barang, cara pembayaran, dan rule sumber akun sebelum journal-generation engine dibangun.

Setting Akuntansi **bukan** workspace pekerjaan Akuntansi.

Pembuatan akun, pemeliharaan akun, kode akun, jurnal, buku besar, neraca saldo, laporan keuangan, closing, koreksi, dan review posting tetap dimiliki modul **Akuntansi**.

## Ownership Boundary

### Modul Akuntansi owns

- membuat akun;
- mengubah/nonaktifkan akun;
- menghasilkan kode akun secara otomatis;
- menjaga uniqueness kode akun;
- canonical Chart of Accounts;
- journal generation/posting;
- General Ledger;
- trial balance;
- financial statements;
- period/closing/reversal/reconciliation.

### Setting Akuntansi owns

- memilih akun yang sudah tersedia dari modul Akuntansi;
- menghubungkan reference cara pembayaran milik POS ke akun;
- menghubungkan Jenis Barang ke akun Persediaan/HPP/Penjualan;
- mendefinisikan Jenis Transaksi;
- menyimpan ordered Debit/Credit source rules;
- menampilkan status konfigurasi Lengkap / Belum Lengkap;
- menampilkan preview konfigurasi rule tanpa posting.

Tidak ada input kode akun atau account-maintenance workflow di Setting Akuntansi.

## Account Reference Compatibility

Prototype saat ini belum tersambung ke canonical Accounting account source. Karena itu tabel lokal `chart_of_accounts` diperlakukan sebagai **bootstrap/reference mirror sementara** agar dropdown mapping dapat diuji.

Runtime Setting Akuntansi memperlakukan daftar akun tersebut read-only.

API account-maintenance melalui `/api/admin/settings/accounting/accounts...` ditolak dengan `ACCOUNT_MAINTENANCE_OWNED_BY_ACCOUNTING`.

Saat modul Akuntansi terkoneksi, daftar akun untuk dropdown harus dibaca/sinkronkan dari source canonical Akuntansi tanpa mengubah UX mapping transaksi.

Account code policy canonical adalah `AUTO_UNIQUE_BY_ACCOUNTING_MODULE`: user tidak mengetik kode akun secara manual di Setting Akuntansi.

## Canonical Storage Conventions

- IDs adalah stable `TEXT` strings.
- Internal Prototype Leker SQL menggunakan `snake_case`.
- Boolean menggunakan `INTEGER` constrained `0/1`.
- Financial transaction totals tetap exact integer money values.
- Unit-cost/HPP baru menggunakan exact scaled integers, tidak `REAL/FLOAT`.
- Inventory quantity fractional-capable exact decimal tetap compatibility migration terpisah.

## Configuration Structures

### `chart_of_accounts`

Local reference/bootstrap mirror untuk akun yang secara domain dimiliki modul Akuntansi.

Fields mencakup `id`, `store_id`, `code`, `name`, `type`, `subtype`, `is_active`, `review_required`, timestamps.

Setting Akuntansi tidak menyediakan create/edit/deactivate UI untuk akun ini.

### `payment_methods`

Registry cara pembayaran/settlement milik POS Core yang dapat dipakai transaksi operasional. Setting Akuntansi tidak menentukan apakah suatu metode valid untuk commit POS; ia hanya mengatur mapping Accounting terhadap reference metode yang sudah ada.

Schema compatibility saat ini masih menyimpan `account_id` nullable pada row yang sama. POS Core membaca hanya `id`, `code`, `name`, `is_active`, dan `is_default`; hanya Accounting bridge yang membaca `account_id`. Karena itu row aktif tanpa akun tetap valid bagi POS dan akan fail-closed sebagai `NEEDS_PAYMENT_MAPPING` hanya pada delivery Accounting post-commit.

Contoh:

- Uang Laci → Kas;
- Non Tunai/Transfer → Bank;
- settlement tertunda → Piutang settlement;
- Hutang → Utang Usaha.

Legacy management endpoint masih berada di route Setting Akuntansi selama refactor ADR-038 belum selesai. Posisi route tersebut bukan domain ownership baru dan tidak boleh dipakai POS runtime sebagai dependency ke Accounting.

### `item_categories`

Mapping Jenis Barang (`product_kinds`) ke akun:

- Inventory/Persediaan;
- HPP;
- Revenue/Penjualan nullable.

Satu transaksi dapat berisi banyak barang dari banyak Jenis Barang. Journal engine masa depan harus resolve setiap kelompok Jenis Barang berdasarkan mapping ini.

### `transaction_categories`

Jenis transaksi store-scoped dengan stable code, flags kebutuhan payment/item category, status aktif, description, dan registering module.

Initial categories:

- Penjualan;
- Pembelian Bahan;

New Jenis Barang receive an editable starting mapping: Persediaan Bahan, Harga Pokok Penjualan, and Penjualan. This guarantees every account picker starts with a canonical default while the administrator remains able to change the mapping.

### Payment default

Exactly one active `payment_methods` row per store is marked `is_default = 1`. Cashier payment pickers read this flag through the POS Core payment-method boundary. The initial default is CASH. The current administrator writer remains a transitional legacy surface pending the ADR-038 provider refactor.
- Operasional;
- Gaji;
- Setoran.

Warehouse mendaftarkan transaction categories terkait ke registry yang sama.

### `journal_rules`

Ordered configuration rows per transaction category dengan:

- label;
- side `DEBIT | CREDIT`;
- source type;
- optional fixed account;
- active state;
- sort order.

Allowed source types:

- `fixed_account`;
- `payment_method`;
- `item_category_inventory`;
- `item_category_cogs`;
- `item_category_revenue`;
- `cost_center_cash`.

Rule dapat berjumlah lebih dari dua. Satu kategori transaksi boleh memiliki banyak baris Debit dan banyak baris Credit.

## Transaction-Centric UI Direction

UI utama Setting Akuntansi harus dibaca berdasarkan **Jenis Transaksi**, bukan berdasarkan istilah teknis database.

Contoh Penjualan:

- sisi pembayaran menampilkan komponen Uang Laci, Non Tunai, QRIS, settlement lain, dst.;
- setiap komponen pembayaran dilink ke akun dari Akuntansi;
- sisi barang membaca Jenis Barang seperti Pentol, Leker, Minuman;
- setiap Jenis Barang menampilkan akun Persediaan/HPP/Penjualan yang sudah dilink.

Contoh Operasional:

- sisi Debit dapat memiliki Beban 1, Beban 2, Beban 3, dst.;
- sisi Credit dapat memiliki Uang Laci, Bank, Hutang, atau settlement lain;
- jumlah komponennya tidak dibatasi dua.

Istilah teknis seperti `source_type` boleh tetap ada di persistence/API, tetapi UI harus menerjemahkannya menjadi bahasa operasional yang mudah dibaca pemilik bisnis.

## Completeness

Kategori structurally **Lengkap** jika memiliki minimal satu active Debit rule dan satu active Credit rule.

Status ini hanya menilai konfigurasi. Ia tidak berarti jurnal sudah/postable secara otomatis.

## Immutable Configuration Snapshot

Operational facts dapat menyimpan `transaction_accounting_snapshots` sebagai evidence konfigurasi saat transaksi terjadi:

- source type/id;
- transaction category code;
- payment method code;
- configuration status;
- timestamp.

Snapshot tidak menyimpan atau mem-post journal lines.

## Explicitly Out of Scope

- create/edit akun dari Setting Akuntansi;
- account-code generation dari Setting Akuntansi;
- journal generation;
- journal posting;
- General Ledger;
- trial balance;
- laporan keuangan;
- closing/reversal;
- direct write ke separate Accounting program database.

## DOC-IMPACT

**REQUIRED** — ownership boundary diperjelas: Accounting owns account maintenance + automatic unique account-code generation + accounting work; Setting Akuntansi hanya owns mapping/configuration.
