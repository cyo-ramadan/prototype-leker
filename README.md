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

## Data isolation

Satu Cloudflare D1 digunakan dengan server-side `store_id` isolation. Barang, kategori, supplier, admin, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, dan laci kas terpisah per gerai.

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

Admin Gerai dapat mengelola gerainya sendiri: identitas toko, Data Barang, Kategori, Supplier, Master Pelanggan, Create/Master Kasir, panel request pelanggan, serta Detail Laci.

Admin Gerai tidak boleh create/mengelola gerai atau mengubah Customer Sharing Group. Dua capability tersebut tetap Owner-only.

Menu **Akuntansi** dan **Laporan** general masih placeholder kosong sesuai scope prototype saat ini.

## Cashier dan laci

Kasir tidak memilih gerai sendiri; server mengambil gerai dari akun kasir. Cashier workspace mempunyai Pilih Menu, Draft Menu, queue order customer, Buka Laci, Beli Bahan, Pengeluaran, Pendapatan Lain, Detail Laci, dan Tutup Laci.

Satu gerai hanya boleh mempunyai satu laci `OPEN`. Banyak akun kasir berbeda dapat digunakan bergantian, tetapi browser yang sama hanya mempunyai satu tab staff aktif. Hanya kasir pembuka laci aktif yang mempunyai cashier write authority.

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
- `0011_staff_single_session.sql` — single active staff session invariant; customer session tetap multi-session.

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
- `adr/ADR-006-separated-customer-staff-login.md`

## Live Photo, Portal Staf, dan deploy gate

Changeset drawer-bound terbaru menambahkan protocol versioned tanpa mengganti domain lama:

- reusable camera canonical: `public/camera-snapshot-modal.js`;
- Portal Staf: `/staff` dengan Presensi aktif serta isolated KPI, Riwayat Setoran, dan Riwayat Gaji;
- attendance endpoint `POST /api/staff/attendance`, terikat ke authenticated employee dan tidak tergantung status laci;
- Tutup Laci tetap memakai endpoint canonical `POST /api/cashier/drawer/close`, dengan multipart Blob Live Photo dan JSON compatibility;
- per-tab Authorization untuk cashier/staff API dibaca ulang dari `sessionStorage` setiap request;
- migrations `0012` sampai `0015` menambah drawer-bound order source, approval queue, operational ledgers, serta Live Photo/attendance;
- `.github/workflows/ci-deploy.yml` menjalankan syntax check + regression test pada PR, kemudian remote migration + Cloudflare deploy hanya setelah quality gate lolos pada `main`/manual dispatch.

Contract dan rationale berada di `contracts/operational-posting-v1.md`, `contracts/live-photo-staff-portal-v1.md`, ADR-008 sampai ADR-011.

## DOC-IMPACT

**REQUIRED** — login boundary berubah menjadi Pelanggan/Karyawan, staff session/tab exclusivity menjadi security invariant, cashier refresh/bootstrap berubah menjadi snapshot-based request discipline, dan changeset terbaru menambah drawer-bound transactions, approval posting V1, reusable Live Photo, Portal Staf attendance, serta CI/deploy gate.
