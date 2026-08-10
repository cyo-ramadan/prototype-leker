# Prototype Leker

Prototype self-ordering + cashier workspace untuk produk leker. Customer membuat order ke gerai tertentu, sedangkan kasir gerai menangani queue, penjualan walk-in, dan cash drawer.

## Hierarki aplikasi

Struktur aktif sekarang:

1. **Owner** — akun tertinggi. Owner membuat dan memilih gerai.
2. **Gerai** — boundary operasional dan data.
3. **Workspace Gerai** — seluruh master dan transaksi milik gerai tersebut.
4. **Kasir** — akun karyawan yang terikat ke tepat satu gerai pada prototype ini.
5. **Cash Drawer Session** — satu laci aktif per gerai. Kasir yang membuka laci menjadi pemegang write mode sampai laci ditutup.

Gerai bukan master data. `/admin` adalah **Owner Console** untuk create/list gerai. Master baru muncul setelah Owner membuka `/s/<KODE>/admin`.

## Data isolation per gerai

Satu Cloudflare D1 tetap digunakan, tetapi semua data operasional membawa `store_id`. Barang, kategori, supplier, customer, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, dan laci kas tidak dibaca lintas gerai.

Gerai baru yang dibuat dari Owner Console dimulai dengan master kosong. Barang dari gerai lain tidak otomatis disalin. Existing `G001` dan `G002` tetap dipertahankan sebagai data prototype yang sudah ada.

## UI routes

- `/admin` — Owner Console
- `/s/<KODE>/admin` — workspace/master gerai
- `/cashier` — login dan workspace kasir
- `/customer` — customer prototype default `G001`
- `/s/<KODE>/customer` — customer langsung pada gerai tertentu

Customer prototype masih memiliki selector gerai untuk testing. Field **Kiosk / Booth** adalah identitas perangkat di dalam gerai, bukan identitas gerai.

## Owner authentication

Migration `0006_owner_branch_drawer_transactions.sql` membuat `owner_accounts` dan `owner_sessions`.

Temporary prototype Owner:

- username: `owner`
- password: `123456`

Owner session disimpan sebagai bearer token di browser, sementara token hash disimpan di D1. PIN admin lama `123456` dipertahankan hanya sebagai compatibility fallback untuk prototype dan bukan jalur UI utama baru.

## Master per gerai

Workspace gerai menyediakan:

- identitas dan logo gerai
- master barang dengan harga beli/jual dan foto optional
- master kategori
- master supplier
- master customer/contact
- master kasir

Kasir yang dibuat dari sebuah workspace otomatis terikat ke gerai workspace tersebut. Form kasir tidak lagi menyediakan dropdown pindah gerai.

## Cashier workspace

Setelah login, server mengambil gerai dari akun kasir. Kasir tidak memilih gerai dari browser.

Halaman kasir mempunyai:

- **Pilih Menu** seperti customer UI
- **Draft Menu** untuk item yang sedang disusun sebelum penjualan disimpan
- queue order customer
- **Buka Laci**
- **Beli Bahan**
- **Pengeluaran**
- **Pendapatan Lain**
- **Lihat Rincian**
- **Tutup Laci**

### Drawer write ownership

Satu gerai hanya boleh mempunyai satu `OPEN` cash drawer session pada waktu yang sama. Banyak akun kasir boleh login bersamaan dan membaca menu/order, tetapi hanya kasir yang membuka laci aktif yang boleh:

- memproses penjualan walk-in
- mengubah status order customer
- mencatat pembelian bahan
- mencatat pengeluaran
- mencatat pendapatan lain
- menutup laci

Kasir lain berada pada **read-only mode** sampai laci ditutup.

Pembelian bahan pada prototype ini adalah fakta cash movement dan **tidak mengubah stok resmi**. Inventory tetap domain terpisah dan tidak boleh diinfer dari tabel pembelian prototype.

## Transaction tables

Migration `0006_owner_branch_drawer_transactions.sql` menambahkan:

- `suppliers`
- `cash_drawer_sessions`
- `sales`
- `sale_items`
- `purchases`
- `expenses`
- `other_income`

Semua tabel transaksi membawa `store_id`. Transaksi yang berasal dari laci juga membawa `drawer_session_id` dan `cashier_id`.

## Cashier authentication

Migration `0005_cashier_auth.sql` menyediakan `cashiers` dan `cashier_sessions`.

Seed prototype yang tetap tersedia:

- Wowo — username `wowo`, password `wowo123`, gerai `G001`
- Wiwi — username `wiwi`, password `wiwi123`, gerai `G002`

Password seed hanya untuk prototype/testing.

## Database migrations

- `0001_leker_order_schema.sql` — schema order awal
- `0002_admin_master_data.sql` — master admin awal
- `0003_set_prototype_admin_pin.sql` — PIN compatibility prototype
- `0004_multi_store.sql` — store isolation dan migrasi existing data ke `G001`
- `0005_cashier_auth.sql` — akun/session kasir, seed `G002`, Wowo, Wiwi
- `0006_owner_branch_drawer_transactions.sql` — Owner hierarchy, supplier, drawer, dan transaksi store-scoped

## API

Owner:

- `POST /api/owner/login`
- `GET /api/owner/me`
- `POST /api/owner/logout`
- `GET /api/owner/stores`
- `POST /api/owner/stores`
- `PATCH /api/owner/stores/:id`

Customer/public:

- `GET /api/stores`
- `GET /api/menu?store=G001`
- `GET /api/store?store=G001`
- `GET /api/orders/:id?store=G001`
- `POST /api/orders?store=G001`

Branch master, Owner-authenticated:

- `GET /api/admin/bootstrap?store=G001`
- `PUT /api/admin/store?store=G001`
- `POST/PATCH/DELETE /api/admin/products...`
- `POST/PATCH/DELETE /api/admin/categories...`
- `POST/PATCH/DELETE /api/admin/contacts...`
- `GET/POST/PATCH/DELETE /api/admin/suppliers...`
- `GET/POST/PATCH/DELETE /api/admin/cashiers...`

Cashier authenticated:

- `POST /api/cashier/login`
- `GET /api/cashier/me`
- `POST /api/cashier/logout`
- `GET /api/cashier/menu`
- `GET /api/cashier/orders`
- `GET /api/cashier/drawer`
- `POST /api/cashier/drawer/open`
- `POST /api/cashier/drawer/close`
- `GET /api/cashier/drawer/details`
- `GET /api/cashier/suppliers`
- `POST /api/cashier/sales`
- `POST /api/cashier/purchases`
- `POST /api/cashier/expenses`
- `POST /api/cashier/other-income`
- `PATCH /api/cashier/orders/:id/status`

## Runtime architecture

- GitHub: `cyo-ramadan/prototype-leker`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database resmi di account **Dwicahya** tidak digunakan prototype ini.

Static assets tetap asset-first. Worker dijalankan lebih dulu hanya untuk `/api/*`. Polling kasir tetap 5 detik dan pause ketika tab hidden.

## Deployment

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

Cloudflare Workers Builds:

- Repository: `cyo-ramadan/prototype-leker`
- Production branch: `main`
- Build command: kosong
- Deploy command: `npm run deploy`
- Root: `/`

### Migration recovery

`0006` bersifat additive terhadap schema multi-store existing. Sebelum promotion ke production, backup D1 wajib diambil. Jika migration gagal, hentikan deployment dan restore database dari backup/Time Travel sebelum mencoba migration yang sudah dikoreksi. Jangan menjalankan query manual parsial untuk menebak state schema.

## DOC-IMPACT

**REQUIRED** — Hierarki admin berubah menjadi Owner → Gerai → Workspace Gerai. Gerai dikeluarkan dari master, supplier menjadi master store-scoped, cashier master menjadi branch-scoped, dan cashier mendapat cash drawer ownership serta transaction workspace. Penjualan, pembelian, pengeluaran, dan pendapatan lain sekarang mempunyai store isolation dan drawer attribution.
