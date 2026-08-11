# Prototype Leker

Prototype self-ordering + cashier workspace untuk produk leker. Halaman utama domain adalah customer ordering. Customer dapat membeli sebagai guest atau login sebagai pelanggan. Dari halaman yang sama tersedia login Kasir dan Owner.

## Hierarki aplikasi

1. **Owner** — akun tertinggi untuk create dan memilih gerai.
2. **Gerai** — boundary operasional dan data.
3. **Workspace Gerai** — seluruh master milik gerai tersebut.
4. **Kasir** — akun karyawan yang terikat ke satu gerai.
5. **Cash Drawer Session** — satu laci aktif per gerai; pemegang laci mendapat write mode.
6. **Pelanggan** — identity store-scoped yang boleh login, tetapi login tidak diwajibkan untuk membeli.

Gerai bukan master data. `/admin` adalah Owner Console. Master baru muncul setelah Owner membuka `/s/<KODE>/admin`.

## Data isolation per gerai

Satu Cloudflare D1 digunakan dengan isolasi `store_id`. Barang, kategori, supplier, pelanggan, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, dan laci kas tidak dibaca lintas gerai.

Gerai baru dimulai dengan master kosong. Existing `G001` dan `G002` tetap dipertahankan.

## Customer-first entry

Routes:

- `/` — halaman customer utama
- `/customer` — halaman customer
- `/s/<KODE>/customer` — customer langsung pada gerai tertentu
- `/cashier` — workspace/login kasir
- `/admin` — Owner Console
- `/s/<KODE>/admin` — workspace/master gerai

Customer page mempunyai selector gerai dan tombol **Login**. Login memiliki role:

- **Pelanggan** — tetap di halaman customer setelah login dan menampilkan Customer ID.
- **Kasir** — memakai cashier auth yang sudah ada lalu masuk `/cashier`.
- **Owner** — memakai Owner auth lalu masuk `/admin`.

Guest checkout tetap aktif. Login pelanggan bukan syarat pembelian.

## Master Pelanggan per gerai

Migration `0007_customer_identity_unified_entry.sql` menambahkan tabel `customers` dan `customer_sessions`.

Setiap pelanggan memiliki:

- `customer_code` / Customer ID
- nama
- telepon
- email
- catatan
- status aktif
- username optional
- password hash optional
- `store_id`

Username/password hanya diperlukan jika pelanggan ingin login. Customer master tetap valid tanpa akun login.

Existing `contacts` dimigrasikan ke `customers` sebagai pelanggan tanpa credential login, sehingga data lama tidak hilang. UI workspace gerai sekarang menjadikan **Master Pelanggan** sebagai master customer canonical; tabel `contacts` tetap dipertahankan sebagai compatibility data lama.

Customer username hanya harus unik di dalam gerai yang sama. Akun pelanggan G001 tidak dapat dipakai sebagai akun G002.

## Customer order attribution

Migration `0007` menambahkan nullable `orders.customer_id`.

- Guest checkout → `customer_id = NULL`.
- Pelanggan login → server membaca Customer ID dari customer bearer session dan menyimpan `customer_id` pada order.
- Browser tidak boleh memilih atau mengirim Customer ID sebagai sumber otoritatif.

## Owner authentication

Temporary prototype Owner:

- username: `owner`
- password: `123456`

Owner token disimpan pada browser session dan token hash disimpan di D1. PIN admin lama dipertahankan hanya sebagai compatibility fallback prototype.

## Master per gerai

Workspace gerai menyediakan:

- identitas/logo gerai
- barang
- kategori
- supplier
- pelanggan
- kasir

Master dan transaksi seluruhnya store-scoped.

## Cashier workspace

Setelah login, server mengambil gerai dari akun kasir. Kasir tidak memilih gerai sendiri.

Cashier workspace mempunyai Pilih Menu, Draft Menu, queue customer, Buka Laci, Beli Bahan, Pengeluaran, Pendapatan Lain, Lihat Rincian, dan Tutup Laci.

Satu gerai hanya boleh mempunyai satu laci `OPEN`. Banyak kasir boleh login bersamaan, tetapi hanya pemegang laci yang boleh melakukan cashier write actions.

Seed kasir prototype:

- Wowo — `wowo` / `wowo123` — `G001`
- Wiwi — `wiwi` / `wiwi123` — `G002`

## Database migrations

- `0001_leker_order_schema.sql` — schema order awal
- `0002_admin_master_data.sql` — master admin awal
- `0003_set_prototype_admin_pin.sql` — PIN compatibility prototype
- `0004_multi_store.sql` — store isolation
- `0005_cashier_auth.sql` — cashier auth + G002 seed
- `0006_owner_branch_drawer_transactions.sql` — Owner hierarchy, supplier, drawer, transaksi
- `0007_customer_identity_unified_entry.sql` — branch customer master, customer session, customer attribution pada order

## API tambahan pelanggan

Public/authenticated customer:

- `POST /api/customer/login?store=<KODE>`
- `GET /api/customer/me?store=<KODE>`
- `POST /api/customer/logout?store=<KODE>`

Owner-authenticated branch master:

- `GET /api/admin/customers?store=<KODE>`
- `POST /api/admin/customers?store=<KODE>`
- `PATCH /api/admin/customers/:id?store=<KODE>`
- `DELETE /api/admin/customers/:id?store=<KODE>`

Existing Owner, cashier, menu, order, supplier, product, category, and drawer APIs remain in place.

## Runtime architecture

- GitHub: `cyo-ramadan/prototype-leker`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database Dwicahya tidak digunakan prototype.

## Deployment and recovery

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

`0007` bersifat additive dan menyalin legacy contacts ke customer master baru. Jika migration gagal, hentikan deployment dan restore database dari backup/Time Travel sebelum mencoba migration yang sudah dikoreksi. Jangan menjalankan query manual parsial untuk menebak state schema.

## Architecture decisions

- `adr/ADR-001-owner-branch-drawer-hierarchy.md`
- `adr/ADR-002-customer-first-entry-and-optional-identity.md`

## DOC-IMPACT

**REQUIRED** — Entry utama sekarang customer-first dengan unified login menu. Customer login bersifat optional, Master Pelanggan menjadi store-scoped master di setiap gerai, legacy contacts dimigrasikan, dan order pelanggan login menyimpan Customer ID yang diturunkan server-side dari session.
