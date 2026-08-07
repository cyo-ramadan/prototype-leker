# Prototype Leker

Prototype self-ordering kiosk untuk produk leker. Customer memilih menu di UI kiosk, mengirim order ke kasir, lalu kasir mengubah status pesanan dari **NEW → PREPARING → READY → COMPLETED**.

## UI

- `/customer` — self-order UI customer
- `/cashier` — dashboard kasir
- `/admin` — protected admin master console

Customer UI menggunakan side cart drawer: menu tetap berada di posisi scroll terakhir, handle keranjang kecil di sisi kanan menampilkan total quantity, dan tap atau swipe dari tepi kanan membuka review order. Item yang sudah dipilih menampilkan quantity stepper langsung pada menu card. Pada mobile, slot control memiliki ukuran tetap supaya perubahan `+` menjadi `− qty +` tidak mengubah proporsi card atau mendorong grid keluar viewport.

## Prototype scope

- 20 varian leker + harga
- Side cart drawer + quantity indicator pada menu card
- Cart, quantity, item note, general note
- Nomor pesanan harian otomatis
- Shared multi-device order state via Cloudflare D1
- Customer status polling sampai READY
- Green READY notification/button
- Cashier queue dan status update
- Admin master toko/logo
- Admin master barang: harga beli, harga jual, kategori, status aktif, foto optional
- Default product image ketika foto kosong
- Admin master kategori
- Admin master customer/contact
- No payment yet; CTA customer mengirim order langsung ke kasir

## Admin security

Admin master data dilindungi PIN 4–12 digit. Pada setup pertama, PIN dibuat langsung di `/admin` dan hash SHA-256 disimpan di D1. Browser mengirim PIN melalui header `X-Admin-Pin` untuk request admin dan menyimpannya hanya di `sessionStorage` selama tab/session aktif. PIN tidak perlu dikirim lewat chat atau ditulis di source repository.

Setup pertama hanya boleh dilakukan sekali. Prototype ini tetap belum memiliki identity provider atau role-based access control produksi.

## Runtime architecture

Environment prototype dipisahkan dari environment resmi MAXI:

- GitHub: source code
- Cloudflare account: **Daily Napkin**
- Cloudflare Worker: `prototype-leker-v2` — HTTP API + static UI
- Cloudflare D1: relational persistence melalui binding `env.DB`
- Prototype D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database resmi `maxi-db` di account **Dwicahya** tidak digunakan oleh prototype ini.

Static UI menggunakan Cloudflare Static Assets secara asset-first. Worker script dijalankan lebih dulu hanya untuk `/api/*`, sehingga request HTML/CSS/JS tidak menghabiskan Workers Free request quota. Customer dan cashier polling setiap 5 detik dan berhenti ketika tab tidak visible.

Customer menu normalnya dibaca dari `GET /api/menu`. File static `public/menu.json` menyimpan snapshot 20 produk yang sama sebagai fallback UI ketika API tidak tersedia atau sedang terkena quota limit. Produk yang mempunyai foto dari admin mengirim `imageData`; produk tanpa foto menggunakan `public/default-product.svg`.

## Database schema

Migration `migrations/0001_leker_order_schema.sql` membuat:

- `products`
- `orders`
- `order_items`
- `order_status_history`

Migration `migrations/0002_admin_master_data.sql` menambahkan `purchase_price` dan `image_data` pada products, serta membuat:

- `categories`
- `store_settings`
- `contacts`

## Deployment

Apply migration dan deploy Worker dengan satu command:

```bash
npm run deploy
```

Script tersebut menjalankan:

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

Cloudflare Workers Builds production configuration:

- Repository: `cyo-ramadan/prototype-leker`
- Production branch: `main`
- Build command: **leave completely blank**
- Deploy command: `npm run deploy`
- Root directory: `/`

## API

Public/customer:

- `GET /api/menu`
- `GET /api/store`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PATCH /api/orders/:id/status`
- `POST /api/reset` (prototype/test only)

Admin:

- `GET /api/admin/status`
- `POST /api/admin/setup`
- `GET /api/admin/bootstrap`
- `PUT /api/admin/store`
- `POST/PATCH/DELETE /api/admin/products`
- `POST/PATCH/DELETE /api/admin/categories`
- `POST/PATCH/DELETE /api/admin/contacts`

## Workers Free quota note

Workers Free memiliki quota harian untuk Worker invocations. Static asset request tidak perlu memanggil Worker. Karena itu `assets.run_worker_first` hanya diarahkan ke `/api/*`, dan polling UI tidak boleh agresif. Jika Cloudflare mengembalikan Error 1027 / HTTP 429, tunggu quota harian reset atau gunakan plan yang sesuai; jangan menganggap pesan "temporarily rate limited" sebagai status temporary account.

## DOC-IMPACT

**REQUIRED** — Customer mobile grid sekarang memakai fixed-size control slot untuk menjaga proporsi saat quantity berubah. Prototype juga memiliki protected `/admin` untuk master toko/logo, barang, kategori, dan customer/contact, dengan migration D1 baru. Order lifecycle, cashier status contract, Worker identity, account boundary, dan deployment flow tetap sama.
