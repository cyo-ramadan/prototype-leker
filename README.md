# Prototype Leker

Prototype self-ordering + cashier workspace untuk produk leker. Halaman utama domain adalah customer ordering. Customer dapat membeli sebagai guest atau login. Dari satu form username/password, backend mengenali akun Pelanggan, Kasir, Admin Gerai, atau Owner secara otomatis.

## Hierarki aplikasi

1. **Owner** - akun tertinggi untuk create gerai dan mengatur kebijakan lintas gerai seperti Berbagi Pelanggan.
2. **Gerai** - boundary operasional dan data.
3. **Admin Gerai** - staff management yang terikat tepat ke satu gerai.
4. **Workspace Gerai** - master dan detail operasional milik gerai tersebut.
5. **Kasir** - akun karyawan yang terikat ke satu gerai.
6. **Cash Drawer Session** - satu laci aktif per gerai; pemegang laci mendapat write mode.
7. **Pelanggan** - customer identity dengan home store dan optional login.

Gerai bukan master data. `/admin` adalah Owner Console. Workspace gerai dibuka melalui `/s/<KODE>/admin`.

## Identity boundary

Master Pelanggan hanya menyimpan identitas pelanggan. Owner, Admin Gerai, dan Kasir tidak disimpan di Master Pelanggan.

Internal access identity dan customer identity tetap domain terpisah walaupun public UI memakai satu form login. Admin Gerai disimpan di `store_admins`, Kasir di `cashiers`, Owner di `owner_accounts`, dan customer di `customers`.

## Data isolation dan customer-sharing exception

Satu Cloudflare D1 digunakan dengan server-side `store_id` isolation. Barang, kategori, supplier, admin, kasir, order, penjualan, pembelian, pengeluaran, pendapatan lain, dan laci kas tetap terpisah per gerai.

**Pelanggan adalah satu-satunya scope yang boleh melebar antar gerai**, dan hanya bila Owner memasukkan gerai-gerai tersebut ke Customer Sharing Group yang sama. Customer tetap mempunyai home `store_id`; row customer tidak dicopy atau digabung secara fisik.

Gerai baru dimulai dengan master operasional kosong. Existing `G001` dan `G002` tetap dipertahankan.

## Customer-first entry dan unified login

Routes:

- `/` - halaman customer utama
- `/customer` - halaman customer
- `/s/<KODE>/customer` - customer langsung pada gerai tertentu
- `/cashier` - workspace/login kasir
- `/admin` - Owner Console
- `/s/<KODE>/admin` - workspace gerai

Customer page mempunyai selector gerai dan satu tombol **Login**. Form login hanya username + password, tanpa pilihan role.

`POST /api/auth/login?store=<KODE>` melakukan role resolution server-side:

- **Owner** - global account, redirect `/admin`.
- **Admin Gerai** - global username, account menentukan gerai, redirect `/s/<GERAI_ADMIN>/admin`.
- **Kasir** - global username, account menentukan gerai, redirect `/cashier`.
- **Pelanggan** - dicari pada selected gerai atau explicit Customer Sharing Group gerai tersebut.

Jika credential yang sama cocok ke lebih dari satu akun aktif, login ditolak dengan `AMBIGUOUS_LOGIN`. Guest checkout tetap aktif.

## Owner Console

Owner dapat:

- create dan melihat gerai;
- membuka workspace tiap gerai;
- mengatur **Berbagi Pelanggan** dengan membuat grup dan memilih gerai anggota.

Satu gerai hanya boleh menjadi anggota satu Customer Sharing Group. Saat sebuah grup akan diaktifkan, sistem menolak konfigurasi bila ada username pelanggan yang bentrok antar gerai anggota.

Customer sharing tidak membagikan barang, admin, kasir, supplier, order, sales, purchase, expense, atau drawer.

## Admin Gerai

Admin Gerai terikat ke satu `store_id`. Admin boleh membuka workspace gerainya dan mengelola identitas toko, Data Barang, Kategori, Supplier, Master Pelanggan, Create Kasir/Master Kasir, serta membaca Detail Laci gerai tersebut.

Admin Gerai tidak boleh create/mengelola gerai dan tidak boleh mengubah Customer Sharing Group. Dua capability tersebut tetap Owner-only. Server menolak token Admin G001 bila request management mencoba memakai context G002.

Browser menyimpan Admin session terpisah dari Owner, Cashier, dan Customer session.

## Workspace Admin Gerai

Workspace gerai menyediakan:

- Toko / identitas gerai;
- Data Barang;
- Kategori;
- Supplier;
- Master Pelanggan;
- Create Kasir / Master Kasir;
- Akuntansi - placeholder kosong;
- Laporan - placeholder kosong;
- Detail Laci.

Akuntansi sengaja belum membuat jurnal, chart of accounts, atau mapping akun. Laporan general juga masih placeholder; laporan operasional shift tersedia lewat Detail Laci.

## Master Pelanggan

Migration `0007_customer_identity_unified_entry.sql` menambahkan `customers`, `customer_sessions`, dan nullable `orders.customer_id`.

Pelanggan mempunyai Customer ID, nama, kontak, catatan, status, optional username/password, dan home `store_id`. Existing legacy contacts dimigrasikan tanpa credential login.

Jika gerai tidak berada dalam sharing group, Master Pelanggan hanya membaca customer gerai itu. Jika Owner mengaktifkan sharing, gerai anggota membaca authorized customer scope yang sama dan UI tetap menunjukkan **Asal Gerai** setiap customer.

- Guest order -> `customer_id = NULL`.
- Logged customer -> server menurunkan `customer_id` dari bearer session.
- Browser tidak berwenang memilih Customer ID.

## Loyalty point foundation

Migration `0008_branch_admin_drawer_customer_sharing.sql` menambahkan `customer_point_ledger` untuk future point system. Ledger menyimpan signed `points_delta`, `EARN | REDEEM | ADJUSTMENT`, customer, source gerai, optional sharing group, reference, notes, dan timestamp.

**Belum ada automatic earn atau redeem.** Formula seperti rupiah per poin, nilai redeem, minimum redeem, expiry, multiplier promo, dan reversal belum ditentukan oleh business rule, jadi prototype tidak mengarang nilai tersebut.

Setelah aturan poin ditentukan, customer dari G001 dapat earn/redeem di G002/G003 selama gerai-gerai itu berada pada Customer Sharing Group yang sama.

## Prototype demo accounts

Migration `0009_branch_admin_and_demo_accounts.sql` menambahkan role Admin Gerai dan seed account untuk testing. Password disimpan sebagai SHA-256 hash di D1; plaintext di bawah hanya credential fixture prototype.

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

Seed ini menjamin dua **login fixture** per role/per gerai tanpa menghapus unrelated customer atau cashier yang mungkin sudah dibuat manual.

## Cashier workspace dan laci

Kasir tidak memilih gerai sendiri; server mengambil gerai dari akun kasir.

Cashier workspace mempunyai Pilih Menu, Draft Menu, queue customer, Buka Laci, Beli Bahan, Pengeluaran, Pendapatan Lain, Detail Laci, dan Tutup Laci.

Satu gerai hanya boleh mempunyai satu laci `OPEN`. Banyak kasir boleh login bersamaan, tetapi hanya kasir yang membuka laci aktif yang boleh melakukan cashier write actions. Kasir lain tetap dapat melihat data gerainya dalam read-only mode.

## Detail Laci

Detail Laci dapat dibaca dari Admin Gerai dan Kasir, tetapi server selalu membatasi drawer ke gerai authorized.

Header report meliputi ID Laci, Penanggung Jawab/kasir pembuka, Shift, Datang/Pulang, Modal/opening amount, closing amount, Insentif, status, dan Keterangan Pulang.

Report menyediakan section Penjualan Bayar Tunai, Promosi, Belanja Bahan Bayar Tunai, Operasional Kas, Operasional Non Kas, Masak, Stok Sisa, Perhitungan Kas, Penjualan Bayar Non Tunai, Belanja Bahan Bayar Non Tunai, Penyesuaian Stok, dan Kas Masuk.

Sale, purchase, dan expense menyimpan payment channel `CASH` atau `NON_CASH`. Existing historical records default `CASH` untuk backward compatibility.

Promotion, Masak, Stok Sisa, dan Penyesuaian Stok saat ini tampil sebagai explicit empty sections karena prototype belum memiliki canonical promotion/production/inventory ledger. Drawer report tidak menebak official stock atau valuation.

Perhitungan expected drawer cash menggunakan cash facts saja:

`opening amount + cash sales - cash promotions + cash-in - cash purchases - cash expenses`

Non-cash sales/purchases/expenses ditampilkan terpisah dan tidak menambah atau mengurangi kas fisik laci.

## Database migrations

- `0001_leker_order_schema.sql` - schema order awal
- `0002_admin_master_data.sql` - master admin awal
- `0003_set_prototype_admin_pin.sql` - PIN compatibility prototype
- `0004_multi_store.sql` - store isolation
- `0005_cashier_auth.sql` - cashier auth + G002 seed
- `0006_owner_branch_drawer_transactions.sql` - Owner hierarchy, supplier, drawer, transaksi
- `0007_customer_identity_unified_entry.sql` - customer identity + order attribution
- `0008_branch_admin_drawer_customer_sharing.sql` - drawer reporting metadata/payment channel, customer sharing groups, point-ledger foundation
- `0009_branch_admin_and_demo_accounts.sql` - Admin Gerai identity/session + demo customer/admin/cashier credentials

## API additions

Owner sharing:

- `GET /api/owner/customer-sharing`
- `POST /api/owner/customer-sharing/groups`
- `PATCH /api/owner/customer-sharing/groups/:id`
- `DELETE /api/owner/customer-sharing/groups/:id`

Admin Gerai auth:

- `POST /api/store-admin/login`
- `GET /api/store-admin/me`
- `POST /api/store-admin/logout`

Admin Gerai drawer:

- `GET /api/admin/drawers?store=<KODE>`
- `GET /api/admin/drawers/:id?store=<KODE>`

Cashier drawer:

- `GET /api/cashier/drawers`
- `GET /api/cashier/drawers/:id/details`
- existing drawer open/close/sale/purchase/expense/income endpoints remain available and drawer-owner protected for writes.

## Runtime architecture

- GitHub: `cyo-ramadan/prototype-leker`
- Cloudflare account: **Daily Napkin**
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`)

Database Dwicahya tidak digunakan prototype.

## Deployment and recovery

`npm run deploy` menjalankan remote D1 migrations lalu `wrangler deploy`.

Migration `0009` additive untuk identity/session Admin Gerai dan seed fixtures. Bila migration/deploy gagal, stop promotion dan restore prototype D1 menggunakan Cloudflare D1 backup/Time Travel sebelum retry migration yang dikoreksi. Jangan menjalankan partial manual schema edits untuk menebak state.

Mematikan Customer Sharing Group menghapus membership sharing dan mengembalikan branch-only customer scope tanpa menghapus customer atau transaksi.

## Architecture decisions

- `adr/ADR-001-owner-branch-drawer-hierarchy.md`
- `adr/ADR-002-customer-first-entry-and-optional-identity.md`
- `adr/ADR-003-branch-admin-drawer-and-customer-sharing.md`
- `adr/ADR-004-store-admin-role-and-demo-accounts.md`

## DOC-IMPACT

**REQUIRED** - Store Admin is now an explicit branch-scoped internal role. Unified login, branch management authorization, migration inventory, demo credentials, and the permission boundary between Owner/Admin/Cashier/Customer are documented together with tests.
