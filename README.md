# Prototype Leker

Prototype self-ordering kiosk untuk produk leker. Customer memilih menu, order masuk ke kasir gerai terkait, lalu kasir mengubah status **NEW → PREPARING → READY → COMPLETED**.

## Multi-store

Prototype memakai **satu Cloudflare D1 dengan isolasi per gerai**. Gerai default hasil migrasi adalah `G001` (`store_001`). Existing products, categories, contacts, orders, order items, dan status history dipindahkan ke gerai default sehingga data lama tetap tersedia.

Setiap gerai mempunyai master sendiri untuk identitas/logo, barang dan harga, kategori, customer/contact, order, cashier queue, serta akun kasir. Store context untuk data operasional divalidasi server-side.

## UI routes

- `/customer` — customer prototype, default `G001`, dengan selector gerai
- `/cashier` — halaman login kasir
- `/admin` — admin master console
- `/s/<KODE>/customer` — customer langsung pada gerai tertentu

Customer prototype menampilkan selector **Gerai**. Field **Kode kiosk / perangkat** tetap terpisah; kiosk adalah identitas perangkat/booth di dalam gerai dan bukan identitas gerai.

## Cashier authentication

Migration `0005_cashier_auth.sql` menambahkan:

- `cashiers` — username, password hash, nama karyawan, gerai, status aktif
- `cashier_sessions` — session token hashed dengan masa berlaku 12 jam

Kasir login melalui `/cashier`. Setelah kredensial valid, server mengambil `store_id` dari akun kasir. Browser tidak menentukan gerai queue. Semua list order, perubahan status, dan reset kasir memakai authenticated cashier session dan `store_id` dari server.

Prototype seed accounts:

- Wowo — username `wowo`, gerai `G001`
- Wiwi — username `wiwi`, gerai `G002`

Password seed hanya untuk prototype/testing dan tidak boleh dibawa ke production.

Admin memiliki tab **Kasir** untuk tambah/edit/nonaktifkan akun. Master kasir berisi username, password, nama karyawan, dan gerai. Password tidak pernah dikirim kembali oleh API; admin hanya dapat menggantinya.

## Customer UX

Customer UI menggunakan side cart drawer, quantity stepper pada menu card, fixed-size mobile control slot, tombol **Pilih menu lagi** setelah checkout, dan selector gerai untuk prototype testing.

Menu normal dibaca dari `GET /api/menu?store=...`. Static `public/menu.json` hanya menjadi fallback untuk gerai default `G001`. Gerai lain tidak menggunakan fallback global agar master antar-gerai tidak tercampur ketika API unavailable.

## Admin security

PIN admin prototype sementara: **`123456`**. Hash SHA-256 disimpan di D1 lewat migration `0003_set_prototype_admin_pin.sql`. Browser mengirim PIN melalui `X-Admin-Pin` dan menyimpannya di `sessionStorage` selama tab/session aktif.

PIN fixed hanya untuk prototype/testing dan tidak boleh dibawa ke production.

## Database schema

- `0001_leker_order_schema.sql` — schema order awal
- `0002_admin_master_data.sql` — master admin
- `0003_set_prototype_admin_pin.sql` — PIN prototype `123456`
- `0004_multi_store.sql` — `stores` + `store_id` isolation dan migrasi existing data ke `store_001`
- `0005_cashier_auth.sql` — akun/session kasir, seed `G002`, Wowo dan Wiwi

Tabel store-scoped utama:

- `products`
- `categories`
- `contacts`
- `orders`
- `order_items`
- `order_status_history`
- `cashiers`

`store_settings` tetap dipakai untuk admin PIN prototype global. Identitas/logo operasional gerai dibaca dari `stores`.

## API

Public/customer:

- `GET /api/stores`
- `GET /api/menu?store=G001`
- `GET /api/store?store=G001`
- `GET /api/orders/:id?store=G001`
- `POST /api/orders?store=G001`

Cashier authenticated:

- `POST /api/cashier/login`
- `GET /api/cashier/me`
- `POST /api/cashier/logout`
- `GET /api/cashier/orders`
- `PATCH /api/cashier/orders/:id/status`
- `POST /api/cashier/reset`

Legacy public queue listing/status mutation/reset are no longer permitted and return `401` because cashier identity is now required.

Admin protected:

- `GET /api/admin/status`
- `POST /api/admin/setup`
- `GET /api/admin/bootstrap?store=G001`
- `POST /api/admin/stores`
- `PATCH /api/admin/stores/:id`
- `PUT /api/admin/store?store=G001`
- `POST/PATCH/DELETE /api/admin/products...`
- `POST/PATCH/DELETE /api/admin/categories...`
- `POST/PATCH/DELETE /api/admin/contacts...`
- `GET/POST /api/admin/cashiers`
- `PATCH/DELETE /api/admin/cashiers/:id`

## Runtime architecture

- GitHub: `cyo-ramadan/prototype-leker`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database resmi di account **Dwicahya** tidak digunakan prototype.

Static assets tetap asset-first dan Worker dijalankan lebih dulu hanya untuk `/api/*`. Polling customer/cashier 5 detik dan pause saat tab hidden.

## Deployment

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

Cloudflare Workers Builds:

- Repository: `cyo-ramadan/prototype-leker`
- Production branch: `main`
- Build command: kosong
- Deploy command: `npm run deploy`
- Root: `/`

### Migration recovery

`0004_multi_store.sql` mempertahankan row existing di `store_001`. `0005_cashier_auth.sql` additive untuk auth dan seed gerai/kasir prototype. Sebelum promotion ke production, backup D1 wajib diambil. Jika migration gagal, hentikan deployment dan restore database dari backup/Time Travel sebelum mencoba migration yang sudah dikoreksi. Jangan menjalankan query manual parsial untuk menebak state schema.

## DOC-IMPACT

**REQUIRED** — Cashier queue sekarang membutuhkan authenticated cashier identity dan server-derived store scope. Admin mendapat master kasir, customer mendapat selector gerai, `G002` serta dua akun kasir prototype ditambahkan, dan public queue mutation endpoints ditutup.
