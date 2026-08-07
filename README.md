# Prototype Leker

Prototype self-ordering kiosk untuk produk leker. Customer memilih menu di UI kiosk, mengirim order ke kasir, lalu kasir mengubah status pesanan dari **NEW → PREPARING → READY → COMPLETED**.

## UI

- `/customer` — self-order UI customer
- `/cashier` — dashboard kasir

## Prototype scope

- 20 varian leker + harga
- Cart, quantity, item note, general note
- Nomor pesanan harian otomatis
- Shared multi-device order state via Cloudflare D1
- Customer status polling sampai READY
- Green READY notification/button
- Cashier queue dan status update
- No payment yet

## Runtime architecture

Environment prototype dipisahkan dari environment resmi MAXI:

- GitHub: source code
- Cloudflare account: **Daily Napkin**
- Cloudflare Worker: `prototype-leker-v2` — HTTP API + static UI
- Cloudflare D1: relational persistence melalui binding `env.DB`
- Prototype D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database resmi `maxi-db` di account **Dwicahya** tidak digunakan oleh prototype ini.

## Database schema

Migration `migrations/0001_leker_order_schema.sql` membuat dan mengindeks:

- `products`
- `orders`
- `order_items`
- `order_status_history`

Migration juga seed 20 produk leker dan memasang trigger untuk mencatat perubahan status ke history.

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
- Build command: `None`
- Deploy command: `npm run deploy`
- Root directory: `/`

Dengan konfigurasi tersebut, unapplied D1 migrations dijalankan sebelum Worker `prototype-leker-v2` diperbarui.

## API

- `GET /api/menu`
- `GET /api/orders`
- `GET /api/orders/:id`
- `POST /api/orders`
- `PATCH /api/orders/:id/status`
- `POST /api/reset` (prototype/test only)

## DOC-IMPACT

**REQUIRED** — Worker permanen diarahkan ke `prototype-leker-v2`, Workers Builds memakai deploy command `npm run deploy`, environment prototype tetap di Daily Napkin, D1 binding tetap ke `prototype-leker-db`, dan deployment flow menjalankan migration sebelum Worker deploy.
