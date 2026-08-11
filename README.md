# Prototype Leker

Prototype self-ordering + branch administration + cashier workspace untuk MAXI Leker. Halaman utama domain adalah customer ordering. Customer dapat membeli sebagai guest atau login. Satu form username/password mengenali Owner, Admin Gerai, Kasir, atau Pelanggan secara server-side.

## Hierarki

1. **Owner** — akun tertinggi, create gerai dan mengatur kebijakan lintas gerai seperti Berbagi Pelanggan.
2. **Gerai** — boundary operasional dan data.
3. **Admin Gerai** — staff management yang terikat satu gerai.
4. **Workspace Gerai** — master dan detail operasional gerai.
5. **Kasir** — akun karyawan yang terikat satu gerai.
6. **Cash Drawer Session** — satu laci aktif per gerai; pemegang laci mendapat write mode.
7. **Pelanggan** — customer identity dengan home store dan optional login.

Gerai bukan master data. `/admin` adalah Owner Console. Workspace gerai berada di `/s/<KODE>/admin`.

## Data isolation

Satu Cloudflare D1 digunakan dengan server-side `store_id` isolation. Barang, kategori, supplier, admin, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, dan laci kas terpisah per gerai.

Pelanggan adalah satu-satunya scope yang dapat melebar antar gerai, hanya jika Owner memasukkan gerai-gerai tersebut ke Customer Sharing Group yang sama. Sharing pelanggan tidak membagikan barang atau transaksi operasional.

G002 pada tahap awal pernah dibuat sebagai copy fixture G001. Migration `0010_customer_registration_points_order_ux.sql` mengganti hanya clone G002 yang masih identik dengan menu demo khusus G002, sambil mempertahankan row G002 yang sudah diedit manual.

## Customer-first entry dan login

Routes utama:

- `/` atau `/customer` — halaman customer.
- `/s/<KODE>/customer` — customer pada gerai tertentu.
- `/cashier` — workspace/login kasir.
- `/admin` — Owner Console.
- `/s/<KODE>/admin` — workspace Admin Gerai.

Customer page mempunyai selector gerai dan satu form login tanpa pilihan role. Backend menentukan role otomatis:

- Owner → `/admin`
- Admin Gerai → `/s/<GERAI_ADMIN>/admin`
- Kasir → `/cashier`
- Pelanggan → tetap di customer page dengan Customer ID aktif

Guest tetap dapat checkout tanpa login.

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

Point ledger tetap menggunakan `customer_point_ledger`. Halaman akun pelanggan sekarang menampilkan saldo poin dari `SUM(points_delta)`. Jika belum ada aktivitas point, saldo tampil **0**.

Formula automatic earn/redeem belum diaktifkan karena business rule rupiah-per-poin, nilai redeem, expiry, dan reversal belum ditentukan.

Jika Customer Sharing Group aktif, customer identity yang sama dapat dipakai di gerai anggota. Ledger tetap menyimpan source gerai sehingga future earn/redeem lintas gerai tetap auditable.

## Status pesanan customer

Halaman customer mempunyai tombol **Pesanan Saya**.

- Customer login membaca order terbaru berdasarkan Customer ID dalam customer-sharing scope yang authorized.
- Guest membaca recent order yang tersimpan lokal pada device untuk gerai tersebut.
- Status yang tampil mengikuti order flow `NEW`, `PREPARING`, `READY`, `COMPLETED`, atau `CANCELLED`.

## Admin Gerai

Admin Gerai dapat mengelola gerainya sendiri: identitas toko, Data Barang, Kategori, Supplier, Master Pelanggan, Create/Master Kasir, panel request pelanggan, serta Detail Laci.

Admin Gerai tidak boleh create/mengelola gerai atau mengubah Customer Sharing Group. Dua capability tersebut tetap Owner-only.

Menu **Akuntansi** dan **Laporan** general masih placeholder kosong sesuai scope prototype saat ini.

## Cashier dan laci

Kasir tidak memilih gerai sendiri; server mengambil gerai dari akun kasir. Cashier workspace mempunyai Pilih Menu, Draft Menu, queue order customer, Buka Laci, Beli Bahan, Pengeluaran, Pendapatan Lain, Detail Laci, dan Tutup Laci.

Satu gerai hanya boleh mempunyai satu laci `OPEN`. Banyak kasir boleh login bersamaan, tetapi hanya kasir pembuka laci aktif yang mempunyai cashier write authority.

## Detail Laci

Detail Laci dibatasi server-side ke gerai authorized dan dapat dibaca Admin Gerai serta Kasir. Report mencakup identitas laci/penanggung jawab, shift, Datang/Pulang, modal, closing amount, insentif, penjualan tunai/non-tunai, pembelian bahan tunai/non-tunai, operasional kas/non-kas, kas masuk, dan perhitungan kas.

Promotion, Masak, Stok Sisa, dan Penyesuaian Stok masih explicit empty sections sampai canonical promotion/inventory/production facts tersedia.

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

## Relevant APIs

Customer:

- `POST /api/auth/login`
- `POST /api/customer/register`
- `GET /api/customer/points`
- `GET /api/customer/orders`

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
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database Dwicahya tidak digunakan untuk prototype.

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

## Architecture decisions

- `adr/ADR-001-owner-branch-drawer-hierarchy.md`
- `adr/ADR-002-customer-first-entry-and-optional-identity.md`
- `adr/ADR-003-branch-admin-drawer-and-customer-sharing.md`
- `adr/ADR-004-store-admin-role-and-demo-accounts.md`
- `adr/ADR-005-customer-approval-and-order-identity.md`

## DOC-IMPACT

**REQUIRED** — registration approval lifecycle, point visibility, server-owned logged-customer order identity, customer order-status access, kiosk-label retirement, and G002 fixture differentiation materially change prototype behavior.
