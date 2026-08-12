# Prototype Leker

Prototype self-ordering Leker dengan customer ordering, cashier workspace, multi-store isolation, drawer ownership, order lifecycle tracking, approval staging/posting, dan portal staf.

## Active Architecture

- Customer ordering tetap terpisah dari authenticated staff workspace.
- Cashier transaction writes terikat ke active drawer owner.
- Penjualan dan Pesanan hidup di dalam workspace Laci Aktif.
- Customer order yang diterima membuat draft penjualan dari response snapshot tanpa re-query item.
- Direct cashier sale menghasilkan lifecycle tracking Diterima → Dibuat → Sudah Jadi.
- Arus Kas, Arus Barang, dan Aset memakai isolated approval queue dan Operational Posting Contract v1.
- Portal Staf tersedia di `/staff` untuk data personal karyawan. Presensi V1 aktif; KPI, Riwayat Setoran, dan Riwayat Gaji disiapkan sebagai domain terisolasi untuk contract berikutnya.

## Reusable Live Photo

`public/camera-snapshot-modal.js` adalah single canonical camera component.

- kamera aktif hanya saat modal terbuka;
- semua MediaStream track dihentikan saat modal ditutup;
- capture dikembalikan sebagai Blob;
- target capture low/medium resolution untuk hemat bandwidth;
- permission denial ditampilkan sebagai graceful visual fallback;
- fitur lain dilarang menduplikasi `getUserMedia`.

Tutup Laci memakai endpoint canonical `POST /api/cashier/drawer/close` dan mengirim multipart Live Photo. Existing JSON close tetap diterima untuk compatibility.

Presensi memakai `POST /api/staff/attendance` dan terikat server-side ke authenticated employee `user_id`. Attendance tidak membutuhkan drawer aktif.

Detail contract: `contracts/live-photo-staff-portal-v1.md` dan ADR-011.

## Per-tab Staff Authorization

`public/staff-auth-fetch.js` memperbarui `Authorization` dari `sessionStorage.lekerCashierToken` pada setiap same-origin request `/api/cashier/*` dan `/api/staff/*`. FormData dibiarkan browser membentuk multipart boundary sendiri.

## Data Migrations

Migrations berada di `migrations/` dan dijalankan berurutan. Changeset terbaru menambahkan:

- `0012_drawer_bound_sales_orders.sql`
- `0013_approval_queue.sql`
- `0014_operational_posting_ledgers.sql`
- `0015_staff_attendance_live_photo.sql`

## Quality & Deployment Gate

GitHub Actions workflow `.github/workflows/ci-deploy.yml` menjalankan:

1. `npm run check`
2. `npm test`
3. pada push ke `main` atau manual dispatch setelah quality gate lolos: remote D1 migrations
4. Cloudflare Worker deploy

Production deploy membutuhkan repository/environment secrets `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID`.

## Local Commands

```bash
npm run check
npm test
npm run db:migrations:apply
npm run deploy
```

Cloudflare configuration canonical berada di `wrangler.jsonc`, Worker `prototype-leker-v2`, D1 binding `DB`, database `prototype-leker-db`.

## Documentation Index

- `KNOWN_ISSUES.md`
- `KNOWN_PITFALLS.md`
- `adr/ADR-008-drawer-bound-sales-order-drafts.md`
- `adr/ADR-009-approval-queue-and-drawer-action-bar.md`
- `adr/ADR-010-operational-posting-v1.md`
- `adr/ADR-011-live-photo-staff-portal.md`
- `contracts/operational-posting-v1.md`
- `contracts/live-photo-staff-portal-v1.md`
