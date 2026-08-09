# Prototype Leker

Prototype self-ordering kiosk untuk produk leker. Customer memilih menu, order masuk ke kasir, lalu kasir mengubah status **NEW → PREPARING → READY → COMPLETED**.

## Multi-store

Prototype sekarang memakai **satu Cloudflare D1 dengan isolasi per gerai**. Gerai default hasil migrasi adalah `G001` (`store_001`). Existing products, categories, contacts, orders, order items, dan status history dipindahkan ke gerai default sehingga data lama tetap tersedia.

Setiap gerai mempunyai master sendiri untuk:

- identitas gerai dan logo
- barang, harga beli, harga jual, foto, status aktif
- kategori
- customer/contact
- orders, cashier queue, dan riwayat status

Store context wajib divalidasi server-side. Endpoint public menerima query `?store=<CODE>` dan hanya membaca/menulis row milik store yang berhasil di-resolve. Admin memakai PIN prototype global untuk memilih serta mengelola gerai, tetapi CRUD master tetap difilter dengan `store_id`.

## UI routes

Legacy/default:

- `/customer`
- `/cashier`
- `/admin`

Store-scoped:

- `/s/G001/customer`
- `/s/G001/cashier`
- `/s/G001/admin`

Untuk gerai lain ganti `G001` dengan kode gerai. Browser menambahkan store context ke setiap `/api/*` request. Active order customer di `localStorage` juga di-scope per store supaya satu perangkat tidak mencampur order antar gerai.

Admin memiliki **Gerai selector** dan master **Gerai** untuk membuat store baru. Setelah memilih gerai, tab Toko, Barang, Kategori, dan Customer hanya memuat data gerai tersebut. Link Customer dan Cashier mengikuti gerai aktif.

## Customer UX

Customer UI menggunakan side cart drawer, quantity stepper pada menu card, fixed-size mobile control slot, dan tombol **Pilih menu lagi** setelah checkout. Customer dapat membuat invoice/order berikutnya tanpa membatalkan order sebelumnya.

Menu normal dibaca dari `GET /api/menu?store=...`. Static `public/menu.json` hanya menjadi fallback untuk gerai default `G001`. Gerai lain tidak menggunakan fallback global supaya master antar gerai tidak bocor saat API unavailable.

## Admin security

PIN admin prototype sementara: **`123456`**. Hash SHA-256 disimpan di D1 lewat migration `0003_set_prototype_admin_pin.sql`. Browser mengirim PIN melalui `X-Admin-Pin` dan menyimpannya di `sessionStorage` selama tab/session aktif.

PIN fixed hanya untuk prototype/testing dan tidak boleh dibawa ke production.

## Database schema

- `0001_leker_order_schema.sql` membuat schema order awal.
- `0002_admin_master_data.sql` menambahkan master admin.
- `0003_set_prototype_admin_pin.sql` menetapkan PIN prototype `123456`.
- `0004_multi_store.sql` membuat `stores`, membangun ulang tabel operasional dengan `store_id`, membuat composite uniqueness per store, dan memigrasikan seluruh data existing ke `store_001`.

Tabel store-scoped:

- `products`
- `categories`
- `contacts`
- `orders`
- `order_items`
- `order_status_history`

`store_settings` tetap dipakai untuk admin PIN prototype global. Identitas/logo operasional gerai dibaca dari `stores`.

## API

Public/store scoped:

- `GET /api/menu?store=G001`
- `GET /api/store?store=G001`
- `GET /api/orders?store=G001`
- `GET /api/orders/:id?store=G001`
- `POST /api/orders?store=G001`
- `PATCH /api/orders/:id/status?store=G001`
- `POST /api/reset?store=G001`

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

## Runtime architecture

- GitHub: `cyo-ramadan/prototype-leker`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database resmi di account **Dwicahya** tidak digunakan prototype.

Static assets tetap asset-first dan Worker dijalankan lebih dulu hanya untuk `/api/*`. Polling customer/cashier tetap 5 detik dan pause saat tab hidden.

## Deployment

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

Cloudflare Workers Builds:

- Repository: `cyo-ramadan/prototype-leker`
- Production branch: `main`
- Build command: kosong
- Deploy command: `npm run deploy`
- Root: `/`

### Migration recovery

`0004_multi_store.sql` mempertahankan row existing dengan menyalinnya ke tabel baru di bawah `store_001`. Sebelum promotion ke production, backup D1 wajib diambil. Jika migration gagal sebelum selesai, hentikan deployment dan restore database dari backup/Time Travel sebelum mencoba migration yang sudah dikoreksi. Jangan menjalankan query manual parsial untuk menebak state schema.

## DOC-IMPACT

**REQUIRED** — Data model, API scoping, admin navigation, customer/cashier routes, order numbering, migration/recovery, dan compatibility berubah untuk mendukung multi-gerai. Legacy `/customer`, `/cashier`, `/admin` tetap diarahkan ke gerai default `G001` untuk backward compatibility.
