# Prototype Leker

Prototype self-ordering + branch administration + cashier workspace untuk MAXI Leker. Halaman utama domain adalah customer ordering. Customer dapat membeli sebagai guest atau login.

## Hierarki

1. **Owner** — akun tertinggi, create gerai dan mengatur kebijakan lintas gerai seperti Berbagi Pelanggan.
2. **Gerai** — boundary operasional dan data.
3. **Admin Gerai** — staff management yang terikat satu gerai.
4. **Workspace Gerai** — master dan detail operasional gerai.
5. **Kasir** — akun karyawan yang terikat satu gerai.
6. **Cash Drawer Session** — satu laci aktif per gerai; pemegang laci mendapat write mode.
7. **Pelanggan** — customer identity dengan home store dan optional login.

Gerai bukan master data. `/admin` adalah Owner Console. Workspace gerai berada di `/s/<KODE>/admin`.

Setiap gerai memiliki `stores.edition`: `LITE`, `FLEXIBLE`, atau `ACCOUNTING`. Default
tetap `ACCOUNTING` agar gerai existing dan caller yang tidak mengirim edition tidak
berubah perilaku; `LITE`/`FLEXIBLE` mempertahankan registry cara bayar POS Core tanpa
Account ID sebagai fondasi produk tanpa Accounting.

## Jalan pintas — agen dengan tugas dari papan `maxi-agent-bus`

Kalau kamu agen implementer (Karen, Kimi, Manus, Grok, atau lainnya) yang ditugaskan lewat
papan tugas: **jangan mulai dari sini.** Buka `agent-bus/CLAIM-PROMPT.md` — prompt itu
sengaja berdiri sendiri (termasuk pola panggilan lewat `curl` buat platform tanpa tool D1
bawaan) supaya tidak ada langkah baca dokumen kedua sebelum kamu bisa mulai.

### Jalan pintas push — GitHub API connector

Jika commit lokal sudah selesai tetapi `git push` HTTPS gagal karena runtime tidak
memiliki credential helper/token, gunakan GitHub connector resmi yang sudah terhubung.
Ini jalur fallback untuk publikasi branch dan PR, bukan bypass review atau branch
protection.

1. Pastikan worktree bersih, test/check sudah hijau, remote target benar, dan akun
   connector punya akses tulis ke repository.
2. Ambil setiap file pada commit lokal sebagai blob (`create_blob`), lalu buat tree
   di atas **tree parent** commit remote (`create_tree`). Jangan mengisi `base_tree`
   dengan SHA commit; GitHub akan menolak dengan `base_tree is not a valid tree oid`.
3. Verifikasi SHA tree hasil API sama dengan `git show -s --format='%T' <commit-lokal>`.
   Kesamaan ini membuktikan snapshot file identik walaupun SHA commit baru dapat berbeda
   karena metadata author/committer dan timestamp connector.
4. Buat commit API dengan parent remote yang tepat, buat/update branch fitur tanpa
   `force`, lalu buka PR. Untuk rangkaian task bertumpuk, pertahankan urutan parent dan
   gunakan base PR sebelumnya agar diff review tetap sempit.
5. Fetch ulang commit/branch/PR dari GitHub, cek changed files dan CI. Merge tetap lewat
   review serta expected-head guard sesuai SOP.

Jangan menyalin PAT, token connector, URL bercredential, atau secret ke remote/config
repo. Jangan mengubah bridge `agent-bridge` menjadi write-capable; bridge tersebut
sengaja read-only. Jika connector tidak memiliki write permission, hentikan publikasi
dan minta koneksi GitHub diperbaiki.

## Data isolation

Satu Cloudflare D1 digunakan dengan server-side `store_id` isolation. Barang, kategori, supplier, admin, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, accounting configuration, posted journal, dan laci kas terpisah per gerai.

Pelanggan adalah satu-satunya scope yang dapat melebar antar gerai, hanya jika Owner memasukkan gerai-gerai tersebut ke Customer Sharing Group yang sama. Sharing pelanggan tidak membagikan barang atau transaksi operasional.

G002 pada tahap awal pernah dibuat sebagai copy fixture G001. Migration `0010_customer_registration_points_order_ux.sql` mengganti hanya clone G002 yang masih identik dengan menu demo khusus G002, sambil mempertahankan row G002 yang sudah diedit manual.

## Customer-first entry dan login

Routes utama:

- `/` atau `/customer` — halaman customer sekaligus entry login.
- `/s/<KODE>/customer` — customer pada gerai tertentu.
- `/cashier` — workspace Kasir setelah login Karyawan.
- `/admin` — Owner Console setelah login Karyawan.
- `/s/<KODE>/admin` — workspace Admin Gerai setelah login Karyawan.

Entry login mempunyai dua tab saja:

- **Pelanggan** — hanya mencari akun pelanggan pada gerai/customer-sharing scope yang authorized.
- **Karyawan** — hanya mencari akun internal dan server menentukan pangkat `OWNER`, `ADMIN`, atau `CASHIER`.

Guest tetap dapat checkout tanpa login. Customer dan Karyawan menggunakan session namespace terpisah sehingga halaman customer dan satu workspace karyawan boleh aktif bersamaan pada tab berbeda.

Login internal langsung melalui `/cashier`, `/admin`, atau workspace gerai tidak menjadi entry utama. Jika tidak ada session yang sesuai, browser diarahkan ke `/?login=staff`.

Legacy `POST /api/auth/login` dipertahankan sementara untuk backward compatibility, tetapi UI baru menggunakan endpoint terpisah supaya akun pelanggan tidak bercampur dengan akun internal.

## Staff single-session dan single-tab policy

Staff mencakup Owner, Admin Gerai, dan Kasir.

- Satu akun staff hanya boleh mempunyai satu server session aktif.
- Login staff kedua mengembalikan `STAFF_SESSION_ACTIVE` dan UI menawarkan **Ambil alih sesi** secara eksplisit.
- Migration `0011_staff_single_session.sql` memasang trigger D1 pada session Owner/Admin/Kasir agar invariant satu session tetap berlaku juga pada legacy/direct login path.
- Customer sessions sengaja tidak memakai rule single-session tersebut.
- Dalam satu browser profile hanya satu tab staff aktif pada satu waktu. Local browser lease mencegah dua tab Karyawan aktif bersamaan, termasuk jika tab diduplicate setelah login.
- Browser lease tidak melakukan network polling. Heartbeat hanya menyentuh `localStorage` untuk mendeteksi duplicate tab.

## Customer registration approval

Customer dapat memilih **Daftar jadi pelanggan** dari halaman customer. Pendaftaran tidak langsung membuat Customer ID aktif.

Flow:

1. Customer memilih gerai dan mengirim nama, kontak, username, dan password.
2. Sistem membuat row `customer_registration_requests` dengan status `PENDING`.
3. Admin Gerai melihat request tersebut pada panel **Request jadi pelanggan**.
4. Admin memilih **ACC** atau **Reject**.
5. Hanya setelah ACC sistem membuat row `customers`, Customer ID, dan login aktif.

Password request disimpan sebagai hash. Admin G001 hanya dapat mereview request G001; Admin G002 hanya request G002.

## Customer identity pada order

Jika customer login, server menurunkan `customer_id` dan `customer_name` dari authenticated session. Browser tidak berwenang mengganti nama order. Field nama di UI dibuat read-only selama pelanggan login.

Jika checkout sebagai guest, nama tetap bebas diisi.

Label kiosk/device sudah dipensiunkan dari UI customer dan kartu order kasir. Kolom database legacy tetap dipertahankan kosong pada order baru untuk backward compatibility.

## Poin pelanggan

Point ledger tetap menggunakan `customer_point_ledger`. Halaman akun pelanggan menampilkan saldo poin dari `SUM(points_delta)`. Jika belum ada aktivitas point, saldo tampil **0**.

Formula automatic earn/redeem belum diaktifkan karena business rule rupiah-per-poin, nilai redeem, expiry, dan reversal belum ditentukan.

Jika Customer Sharing Group aktif, customer identity yang sama dapat dipakai di gerai anggota. Ledger tetap menyimpan source gerai sehingga future earn/redeem lintas gerai tetap auditable.

## Status pesanan customer

Halaman customer mempunyai tombol **Pesanan Saya**.

- Customer login membaca order terbaru berdasarkan Customer ID dalam customer-sharing scope yang authorized.
- Guest membaca recent order yang tersimpan lokal pada device untuk gerai tersebut.
- Status yang tampil mengikuti order flow `NEW`, `PREPARING`, `READY`, `COMPLETED`, atau `CANCELLED`.

## Admin Gerai

Admin Gerai dapat mengelola gerainya sendiri: identitas toko, Data Barang, Kategori, Supplier, Master Pelanggan, Create/Master Kasir, panel request pelanggan, Detail Laci, Stok, Transaksi, **Akuntansi**, **Setting Akuntansi**, dan Warehouse Settings sesuai capability yang aktif.

Master Barang memakai surface harian yang ringkas. Peran Barang, Satuan Dasar, Klasifikasi Accounting, stock policy, points, dan Recipe berada di pengaturan lanjutan. Edit parsial seperti Harga Beli mempertahankan reference lain dan tidak mewajibkan admin memilih ulang field teknis.

Admin Gerai tidak boleh create/mengelola gerai atau mengubah Customer Sharing Group. Dua capability tersebut tetap Owner-only.

### Akuntansi

**Akuntansi** adalah workspace kerja Accounting dan terpisah dari **Setting Akuntansi**.

Aktivitas Accounting yang aktif:

- **Data Akun** — create/maintenance account; account code dibuat otomatis oleh program;
- **Buat Jurnal** — manual balanced journal;
- **Data Jurnal** — sumber yang sama untuk manual journal dan journal dari integration/POS;
- **Buku Besar** — ledger per account;
- **Rugi Laba** — period-scoped revenue/expense report;
- **Neraca** — asset/liability/equity/current-earnings position.

Posted journal immutable. Exact journal values menggunakan scaled INTEGER `1 rupiah = 1,000,000 units`, maksimal enam angka desimal dengan half-up pada digit ketujuh. Derived account/report balances boleh negatif. Manual journal wajib balance exact; system journal hanya boleh memakai dedicated Equity `Penyesuaian` sampai Rp100 bila command secara explicit meminta approved tolerance policy.

### Setting Akuntansi

**Setting Akuntansi** hanya mengatur mapping/configuration dan tidak membuat akun atau melakukan posting jurnal.

- account reference dibaca dari Akuntansi;
- payment method milik POS diarahkan ke account settlement sebagai mapping terpisah;
- Jenis Barang diarahkan ke account Persediaan/HPP/Penjualan;
- transaction categories memiliki ordered Debit/Credit rules;
- status `Lengkap` hanya readiness structure, bukan izin bypass Accounting posting engine.

Untuk Penjualan, baseline resolver mendukung settlement Debit, Pendapatan Credit, HPP Debit, dan Persediaan Credit melalui configured payment method + Jenis Barang. POS mengirim business fact; Accounting yang menginterpretasikan dan mem-posting journal.

## Cashier dan laci

Kasir tidak memilih gerai sendiri; server mengambil gerai dari akun kasir. Cashier workspace mempunyai Pilih Menu, Draft Menu, queue order customer, Buka Laci, Beli Bahan, Pengeluaran, Pendapatan Lain, Penyesuaian Stok, Produksi, Arus Kas, Arus Barang, Aset, Detail Laci, dan Tutup Laci.

Cara bayar Penjualan, Beli Bahan, dan Pengeluaran dibaca dari registry `payment_methods` milik POS Core. Validasi transaksi POS tidak membaca Account ID atau readiness Setting Transaksi; metode aktif tetap sah walaupun belum dipetakan ke akun. POS hanya menyimpan kode metode yang dipilih. Accounting membaca mapping akun secara terpisah setelah fact committed dan fail-closed sebagai `NEEDS_PAYMENT_MAPPING` bila mapping belum tersedia. Hanya kode `CASH` yang memengaruhi kas fisik laci, sedangkan semua metode aktif lainnya diklasifikasikan non-cash.

Jika Operasional memiliki beberapa komponen Debit aktif, kasir memilih komponen berdasarkan identitas journal rule. Untuk Arus Kas, kasir memilih akun lawan hanya dari pilihan per arah yang dikelola admin melalui Setting Akuntansi; pilihan default Setting Akuntansi otomatis terpilih. Pembelian hanya memakai barang purchasable + stock-tracked dari Master Barang; Debit persediaan mengikuti mapping Jenis Barang dan Credit mengikuti metode pembayaran canonical. Satu metode pembayaran aktif ditandai sebagai default oleh admin. Arus Kas yang sudah ACC + posted dikirim post-commit ke Accounting melalui `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1`; kegagalan konfigurasi Accounting tidak membatalkan fakta operasional dan dapat direkonsiliasi secara idempotent.

Satu gerai hanya boleh mempunyai satu laci `OPEN`. Banyak akun kasir berbeda dapat digunakan bergantian, tetapi browser yang sama hanya mempunyai satu tab staff aktif. Hanya kasir pembuka laci aktif yang mempunyai cashier write authority.

### Penyesuaian Stok

Penyesuaian Stok adalah audited Inventory/Costing correction flow dan menggunakan Approval Queue yang sama dengan Arus Kas/Arus Barang/Aset.

- Kasir memilih barang stock-tracked, mengisi target stok fisik, alasan wajib, dan optional note.
- Server menyimpan snapshot stok saat pengajuan, menghitung delta IN/OUT, lalu menyimpan `unitCostSnapshotScaled` dan `totalCostSnapshotScaled` dari HPP saat itu di payload approval yang immutable.
- Pengajuan tidak mengubah stok saat dibuat.
- Admin Gerai/Owner ACC melakukan re-check current stock terhadap snapshot.
- Jika stok berubah setelah pengajuan, request ditolak sebagai `STOCK_ADJUSTMENT_STALE` dan harus diajukan ulang.
- ACC yang valid mengubah `inventory_stock_balances`, menambah `inventory_ledger_entries`, menambah `stock_movements` dengan source `STOCK_ADJUSTMENT`, dan menandai approval posted dalam satu batch.
- Flow v2 mengoreksi quantity dan membawa valuation evidence exact-scaled. Posting adjustment tidak mengubah Average Cost; perubahan HPP berikutnya juga tidak menulis ulang snapshot adjustment lama.

### Refresh dan bootstrap kasir

Periodic network polling sudah dinonaktifkan. Cashier memakai strategi berikut:

- initial state dibaca melalui `GET /api/cashier/workspace`, yang menggabungkan identity, menu, orders, dan status laci dalam satu authenticated snapshot;
- tombol **Refresh Pesanan** melakukan satu workspace snapshot request;
- tab kembali visible/focus melakukan satu workspace snapshot request;
- action kasir memperbarui state setelah request selesai;
- network/quota error tidak diperlakukan sebagai session expiry kecuali server benar-benar mengembalikan auth `401`.

Jika realtime push dibutuhkan kemudian, gunakan mekanisme push yang disetujui seperti WebSocket/SSE setelah impact assessment, bukan periodic polling rapat.

## Detail Laci

Detail Laci dibatasi server-side ke gerai authorized dan dapat dibaca Admin Gerai serta Kasir. Report mencakup identitas laci/penanggung jawab, shift, Datang/Pulang, modal, closing amount, insentif, penjualan tunai/non-tunai, pembelian bahan tunai/non-tunai, operasional kas/non-kas, kas masuk, dan perhitungan kas.

Promotion, Masak, dan beberapa policy/flow inventory lanjutan tetap berkembang melalui contract masing-masing. Penyesuaian Stok audited write flow sudah aktif; valuation journal untuk stock gain/loss tetap menunggu explicit Inventory→Accounting semantics.

## Demo accounts

### G001

| Role | Nama | Username | Password |
|---|---|---|---|
| Pelanggan | Fufu | `fufu` | `fufu123` |
| Pelanggan | Fafa | `fafa` | `fafa123` |
| Admin | Bablil | `bablil` | `bablil123` |
| Admin | King Luhut | `kingluhut` | `luhut123` |
| Kasir | Wowo | `wowo` | `wowo123` |
| Kasir | Sigma Boy | `sigma` | `sigma123` |

### G002

| Role | Nama | Username | Password |
|---|---|---|---|
| Pelanggan | El Kecepatan | `elkecepatan` | `cepat123` |
| Pelanggan | Aura Farming | `aurafarming` | `aura123` |
| Admin | Lord Rizz | `lordrizz` | `rizz123` |
| Admin | Mas Rusdi Prime | `rusdiprime` | `rusdi123` |
| Kasir | Wiwi | `wiwi` | `wiwi123` |
| Kasir | Mewing Max | `mewing` | `mewing123` |

## Database migrations

- `0001_leker_order_schema.sql` — order awal.
- `0002_admin_master_data.sql` — master admin awal.
- `0003_set_prototype_admin_pin.sql` — legacy prototype PIN compatibility.
- `0004_multi_store.sql` — store isolation.
- `0005_cashier_auth.sql` — cashier auth + G002 initial fixture.
- `0006_owner_branch_drawer_transactions.sql` — Owner hierarchy, supplier, drawer, transaksi.
- `0007_customer_identity_unified_entry.sql` — customer identity + order attribution.
- `0008_branch_admin_drawer_customer_sharing.sql` — drawer report, customer sharing, point ledger foundation.
- `0009_branch_admin_and_demo_accounts.sql` — Admin Gerai + demo credentials.
- `0010_customer_registration_points_order_ux.sql` — pending registration requests + distinct G002 demo menu.
- `0011_staff_single_session.sql` — single active staff session invariant; customer session tetap multi-session.
- `0012_drawer_bound_sales_orders.sql` — drawer-bound order source + sale lineage.
- `0013_approval_queue.sql` — isolated approval staging.
- `0014_operational_posting_ledgers.sql` — operational cash/inventory/asset posting V1.
- `0015_staff_attendance_live_photo.sql` — drawer-close Live Photo + staff attendance.
- `0016_manufacturing_master_v1.sql` — manufacturing master foundation.
- `0017_product_stock_production_points.sql` — stock/production/points extension.
- `0018_product_master_accounting_reference.sql` — legacy Accounting compatibility/reference objects.
- `0019_product_costing_and_kinds.sql` — Product Master costing + Jenis Barang.
- `0020_expense_quantity_behavior.sql` — operational quantity metadata.
- `0021_exact_production_costing.sql` — exact scaled production costing.
- `0022_accounting_warehouse_settings.sql` — canonical Accounting/Warehouse Settings registry.
- `0023_accounting_snapshot_settings_compat.sql` — forward compatibility for Accounting readiness snapshots.
- `0024_accounting_workspace.sql` — Accounting journal/workspace storage.
- `0025_accounting_pos_bridge.sql` — POS Accounting delivery/reconciliation state.
- `0026_accounting_six_decimal_precision.sql` — six-decimal exact Accounting precision.
- `0027_transaction_void_permits.sql` — approval permit koreksi transaksi, reversal evidence, dan Raport facts.
- `0028_cash_flow_counterpart_defaults.sql` — default akun lawan Arus Kas per arah.
- `0029_purchase_accounting_defaults.sql` — default Accounting untuk pembelian.
- `0030_g001_purchase_material_master.sql` — master bahan pembelian G001.
- `0031_g001_purchase_material_products.sql` — produk bahan pembelian G001.
- `0032_master_purchase_price.sql` — bootstrap Harga Beli master kosong dari bukti pembelian terakhir; selanjutnya Harga Beli master tetap editable dan independen.
- `0033_customer_feedback.sql` — customer feedback dan private evaluation.
- `0034_cost_master.sql` — Master Biaya/Jenis Biaya.
- `0035_operational_cost_accounting_defaults.sql` — default Accounting untuk biaya operasional.
- `0036_debugger_control_plane.sql` — debugger control plane dan audit log.
- `0037_accounting_schema_reconciliation.sql` — rekonsiliasi orphan Accounting schema dari PR #3 yang tidak jadi di-merge; snapshot bukti disimpan inert, `chart_of_accounts` tetap satu-satunya registry akun canonical.
- `0038_operational_accounting_boundary.sql` — penegakan boundary Operasional/Accounting.
- `0039_tenancy_and_consolidation_foundation.sql` — pondasi SaaS multi-tenant per `ADR-030`: `tenants`, `entities`, `entity_tenancy`, `consolidation_groups`, `consolidation_membership`, plus `stores.entity_id` yang nullable. Aditif; tidak ada tabel lama yang dibangun ulang. Setiap gerai di-backfill jadi satu Entity di bawah satu tenant prototype.

Remote dedicated prototype D1 is migrated through `0036` (applied 2026-08-16). Migration
`0037` dan `0038` sudah ada di repository tetapi **belum applied** ke remote.

Selama `0037` belum applied, empat tabel orphan dari PR #3 (`accounting_accounts`,
`accounting_dimensions`, `accounting_opening_balances`, `accounting_transaction_mappings`)
masih ada di live D1. `scripts/verify-remote-schema.mjs` sengaja menolak deploy selama
tabel itu ada, karena `accounting_accounts` terbaca sebagai parallel Chart of Accounts.
Urutan `npm run deploy` adalah migrate → verify → deploy, jadi menjalankan deploy canonical
akan menerapkan `0037` lebih dulu dan gate tersebut terbuka sendiri; tidak perlu DROP manual
di produksi.

## Relevant APIs

Login:

- `POST /api/auth/customer-login?store=<KODE>`
- `POST /api/auth/staff-login`
- `POST /api/auth/login` — legacy compatibility only

Customer:

- `POST /api/customer/register`
- `GET /api/customer/points`
- `GET /api/customer/orders`

Cashier:

- `GET /api/cashier/workspace`
- `POST /api/cashier/drawer/close` — JSON compatibility atau multipart Live Photo.
- `GET /api/cashier/stock-adjustment/options`
- `POST /api/cashier/approval-requests` — termasuk `GOODS_FLOW` dengan `purpose=STOCK_ADJUSTMENT`.
- `GET /api/cashier/approval-requests`

Management approval:

- `GET /api/management/approval-requests`
- `PATCH /api/management/approval-requests/:id`

Portal Staf:

- `GET /api/staff/portal`
- `POST /api/staff/attendance`

Accounting:

- `GET /api/admin/accounting`
- `POST /api/admin/accounting/accounts`
- `POST /api/admin/accounting/journals`
- `GET /api/admin/accounting/journals`
- `GET /api/admin/accounting/ledger`
- `GET /api/admin/accounting/profit-loss`
- `GET /api/admin/accounting/balance-sheet`
- `GET /api/admin/settings/accounting`

Admin Gerai customer approval:

- `GET /api/admin/customer-requests`
- `PATCH /api/admin/customer-requests/:id`

Owner sharing:

- `GET /api/owner/customer-sharing`
- `POST /api/owner/customer-sharing/groups`
- `PATCH /api/owner/customer-sharing/groups/:id`
- `DELETE /api/owner/customer-sharing/groups/:id`

## Runtime

- GitHub: `cyo-ramadan/prototype-leker`
- production branch: `main`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)
- D1 binding: `DB`
- permanent live URL: `https://prototype-leker-v2.daily-napkin.workers.dev`

Database Dwicahya tidak digunakan untuk prototype.

`npm run deploy` adalah repository-owned canonical deploy command dan menjalankan remote D1 migrations lebih dulu, kemudian `wrangler deploy`.

### Canonical production deployment

Normal deployment menggunakan **Cloudflare Workers Git Integration** yang terhubung ke repository `cyo-ramadan/prototype-leker` branch `main`. Ordinary flow:

`AI changes → tests → merge/push main → Cloudflare Workers Build → npm run deploy → remote D1 migrations → Worker deploy → live validation`.

Bukti deployment canonical di GitHub adalah check **`Workers Builds: prototype-leker-v2`** dari Cloudflare Workers and Pages app. Check tersebut harus `SUCCESS` sebelum deployment dianggap PASS.

Repository juga mempunyai GitHub Actions quality/deploy workflow. Quality gate tetap berguna. Secret-based GitHub Actions deploy path adalah fallback/secondary automation dan membutuhkan `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` pada approved GitHub secret store. Kegagalan job fallback karena secret tidak tersedia tidak membatalkan Cloudflare Git deployment yang sudah terbukti `SUCCESS`; jangan meminta token plaintext kepada Bos Cyo jika Git Integration canonical tersedia.

### D1 migration recovery discipline

Migration ledger saja tidak membuktikan seluruh schema object masih ada. Jika remote migration gagal karena missing object, inspect remote migration state + `sqlite_schema`/`PRAGMA`, capture D1 Time Travel checkpoint/approved backup, repair hanya object yang terbukti hilang dari authoritative migration definition, lalu resume canonical migrations. Jangan rewrite historical migration yang sudah applied untuk menutupi schema drift.

## Architecture decisions

- `adr/ADR-027-pimasatu-and-cost-master.md` — komponen transaksi PIMASATU reusable dan boundary Master Biaya/Jenis Biaya/Accounting.

- `adr/ADR-001-owner-branch-drawer-hierarchy.md`
- `adr/ADR-002-customer-first-entry-and-optional-identity.md`
- `adr/ADR-003-branch-admin-drawer-and-customer-sharing.md`
- `adr/ADR-004-store-admin-role-and-demo-accounts.md`
- `adr/ADR-005-customer-approval-and-order-identity.md`
- `adr/ADR-006-separated-customer-staff-login.md`
- `adr/ADR-008-drawer-bound-sales-order-drafts.md`
- `adr/ADR-009-approval-queue-and-drawer-action-bar.md`
- `adr/ADR-010-operational-posting-v1.md`
- `adr/ADR-011-live-photo-staff-portal.md`
- `adr/ADR-012-manufacturing-master.md`
- `adr/ADR-013-stock-production-points.md`
- `adr/ADR-015-product-master-accounting-reference.md`
- `adr/ADR-016-accounting-warehouse-settings.md`
- `adr/ADR-017-accounting-workspace-vs-accounting-settings-ownership.md`
- `adr/ADR-018-accounting-workspace-and-pos-bridge.md`
- `adr/ADR-019-accounting-six-decimal-precision.md`
- `adr/ADR-020-audited-stock-adjustment-and-stale-snapshot-guard.md`

## DOC-IMPACT

**REQUIRED** — README juga mencatat PIMASATU UI reusable dan Master Biaya yang tetap menyerahkan ownership akun/jurnal kepada Accounting.
