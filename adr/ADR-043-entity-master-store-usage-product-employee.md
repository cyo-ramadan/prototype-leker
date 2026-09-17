# ADR-043 — Entity owns master data, Store owns usage (Master Barang & Master Employee)

Status: PROPOSED — audit + mapping, menunggu keputusan Bos Cyo sebelum ada migration ditulis
Tanggal: 2026-09-17
Diminta oleh: Bos Cyo
Ditulis oleh: Hana

## Konteks

Bos Cyo minta pola **Entity owns the master data, Store owns the usage/operational
data** diterapkan ke dua area: Master Barang dan Master Employee. Instruksinya
eksplisit: audit schema dulu, jangan langsung rewrite, buat mapping
Existing Schema → Target Architecture, identifikasi perubahan minimum, preserve
existing functionality. Dokumen ini adalah hasil audit itu — belum ada kode atau
migration yang ditulis.

Vocabulary Entity/Store yang dipakai di sini sama persis dengan ADR-030: **Entity**
(Badan Usaha) sudah ada sebagai konsep di schema (`entities`, `stores.entity_id`),
tadinya lingkupnya cuma pembukuan (CoA, journal, stock valuation). Permintaan Bos
Cyo kali ini memperluas tanggung jawab Entity ke master data operasional
(Product, Employee) — perluasan wajar dari fondasi yang sama, bukan konsep baru.

## Temuan audit

### Master Employee — SUDAH sesuai pola target, nyaris tidak perlu perubahan

Migration `0072_employee_master_and_account_links.sql` (2026-09-04) sudah membangun
persis pola yang Bos Cyo minta sekarang, untuk Employee:

- `employees` — satu baris per manusia, **milik Entity** (`entity_id NOT NULL`).
  Nama, telepon, alamat, KTP disimpan sekali di sini.
- `employee_account_links` — lapisan usage. Menautkan satu `employee_id` ke satu
  akun login store-specific (`CASHIER`/`STORE_ADMIN`, keduanya wajib `store_id`)
  atau `ENTITY_ADMIN`, berjangka waktu (`effective_from`/`effective_to`, tidak
  pernah di-overwrite — pola sama seperti `entity_tenancy` ADR-030).

Alur "Dermo pilih Budi dari Master Entity" **sudah hidup**: `GET
/api/admin/employees` (`src/employee-master.js`) mengembalikan seluruh karyawan
di entity gerai yang sedang dibuka plus `linkableAccounts` (username Dermo yang
belum punya pemegang), dan `POST /api/admin/employees/:id/links` menautkan Budi
ke salah satu username itu — tanpa membuat baris `employees` baru. UI-nya juga
sudah ada (`public/admin-employees.js`, tombol "Tautkan").

**Satu gap nyata, bukan gap arsitektur**: menautkan Budi ke Dermo tetap butuh
username/password Dermo yang sudah ada duluan (baris di `cashiers`/`store_admins`
dibuat terpisah). Itu bukan duplikasi identitas — cuma provisioning kredensial,
yang memang harus per-gerai (satu akun = satu password, tidak masuk akal
dibagi). Bukan sesuatu yang perlu schema baru.

**Gap yang sudah tercatat terpisah**: "jadwal kerja" dan role/jabatan per-store
belum punya kolom di `employee_account_links` — ini persis Task #13 yang sudah
ada di papan (gaji/insentif/jam kerja), bukan temuan baru dari audit ini.

**Kesimpulan Employee: tidak perlu migration.** Kalau ada pekerjaan, itu di
level UI-polish (mis. menonjolkan alur cross-store di Admin) dan di Task #13 yang
sudah berjalan sendiri.

### Master Barang — TIDAK sesuai pola target, ini gap yang sebenarnya

`products` (skema saat ini, `migrations/0004` + akumulasi `ALTER TABLE` sampai
`0086`) adalah **satu tabel milik Store**, bukan Entity:

```
products(id INTEGER PK, store_id NOT NULL, name, purchase_price, price, category,
  image_data, display_order, is_active, item_type_id, base_unit_id,
  points_per_unit, production_mode, recipe_link_enabled, stock_tracking_enabled,
  linked_recipe_id, product_kind_id, average_cost, last_purchase_price, ...)
```

Tidak ada `entity_id` di tabel ini sama sekali. Identitas barang (nama, foto,
resep) dan data operasional store (harga jual, status aktif, average cost/HPP)
tercampur di baris yang sama, dan baris itu **fisik terpisah per Store** — bukan
dibagi.

Buktinya bukan teori — sudah kejadian di produksi. `migrations/0081_kpm_stores_
from_pendem_template.sql` (onboarding 7 gerai KPM baru dari template Pendem)
secara eksplisit meng-clone `products` per gerai baru: `clone_product_map_0080`
memberi setiap gerai baru **integer id baru** untuk "barang yang sama", dicocokkan
lewat natural key (nama produk, `code` item_type/unit/product_kind) karena tidak
ada satu pun master bersama untuk dirujuk. Komentar di migration itu sendiri
bilang jelas: field katalog (nama, harga, foto) di-**CLONE**, sementara fakta
bisnis (stock, average_cost, HPP, riwayat) sengaja di-reset ke nol per gerai.
Ini justru contoh sempurna dari yang Bos Cyo bilang: "jangan membuat/copy master
barang baru ketika Store lain menggunakan barang tersebut" — hari ini itu yang
terjadi, by design, karena memang belum ada tempat lain untuk barang itu hidup.

Tabel referensi di sekitar Product juga ikut store-scoped dan ikut di-clone
dengan pola sama: `categories`, `item_types` ("Peran Barang", ADR-025),
`units`, `product_kinds`, `manufacturing_recipes` + `manufacturing_recipe_
components` (resep/BOM), `product_groups`, `suppliers`, `contacts`. Semuanya
`store_id NOT NULL`, tidak ada yang carry `entity_id`.

## Mapping: Existing Schema → Target Architecture

| Konsep Bos Cyo | Field/data | Tempat hari ini | Target |
|---|---|---|---|
| Master Barang identity | `product_id`, nama, foto | `products.id/name/image_data` (per Store, di-clone) | **Baru**: `product_masters` (Entity-owned) |
| Resep/detail produk | BOM, item_type, unit, product_kind | `manufacturing_recipes`, `item_types`, `units`, `product_kinds` (per Store, di-clone) | Fase 2 (lihat di bawah) — tetap per-Store untuk sekarang |
| Status aktif di Store | `products.is_active` | Store, sudah benar levelnya | Tetap Store — via baris usage baru |
| Harga jual Store | `products.price` | Store, sudah benar levelnya | Tetap Store |
| Promo Store | (belum ada tabel promo generik) | — | Tetap Store, di luar scope audit ini |
| HPP / Average Cost | `products.average_cost`, `last_purchase_price` | Store — **wajib tetap di Store** (stock fisik dan valuasinya memang per gerai, invariant #1 & ADR-015/019) | Tetap Store |
| Master identity Employee | `employees` | **Sudah** Entity-owned | Tidak berubah |
| Assignment Employee ke Store | `employee_account_links` + `cashiers`/`store_admins` | **Sudah** Store-usage | Tidak berubah |

## Perubahan minimum yang diusulkan (Product Master saja — Employee sudah sesuai)

Mengikuti pola staged ADR-030 (additive, tidak mengubah tabel yang ada, backward
compatible), bukan rewrite:

1. **Tabel baru `product_masters`** (Entity-owned): `id`, `entity_id NOT NULL`,
   `name`, `image_data`, referensi resep/klasifikasi (lingkupnya — lihat "Open
   decision" di bawah), `created_by_role/id`, timestamps. Tidak menyentuh
   `products` yang sudah ada.
2. **Kolom baru `products.product_master_id`** (nullable, FK ke
   `product_masters.id`) — pola identik `stores.entity_id` di migration 0039:
   nullable dulu, backward compatible, tidak ada baris lama yang rusak.
3. **Backfill 1:1**: setiap baris `products` yang sudah ada dapat satu baris
   `product_masters` baru (copy nama/foto/resep-link), lalu `product_master_id`
   diisi. Titik ini sama sekali tidak mengubah perilaku — cuma menambah tempat
   baru yang belum dipakai siapa pun.
4. **Endpoint baru** "katalog Master Barang Entity" + aksi "Gunakan/Aktifkan":
   Store lain (mis. Beji) melihat daftar `product_masters` milik entity-nya,
   pilih satu, sistem membuat **satu baris `products` baru untuk Beji** yang
   menunjuk `product_master_id` yang SAMA (bukan `product_masters` baru) — field
   operasional (`price`, `is_active`, `average_cost=0`, dll) diisi default Store
   Beji sendiri, bukan disalin dari Store pembuat. Ini yang membuat "otomatis
   aktif untuk Store pembuat, tidak otomatis di Store lain" jadi benar: baris
   `products` per Store hanya lahir saat Store itu sendiri klik "Gunakan".
5. Tabel referensi (`item_types`, `units`, `product_kinds`,
   `manufacturing_recipes`) **tidak disentuh di fase ini** — baris baru di Store
   penerima tetap diresolusi ke reference master LOKAL Store itu lewat natural
   key (persis logika yang sudah dipakai migration 0081), bukan dipaksa share.
   Ini yang menahan blast radius: menyentuh reference master menyentuh jalur
   Accounting/Costing (ADR-014/015/019/024/037), yang menurut CLAUDE.md wajib
   baca `KNOWN_PITFALLS.md` dulu dan tidak boleh digabung sembarangan dengan
   perubahan lain.

Yang **tidak** berubah sama sekali: `products.id` (integer) tetap jadi kunci
yang dipakai `order_items`, `sales`, `purchases`, stock movement, cost history,
dst — puluhan foreign key yang ada hari ini tidak tersentuh. Fungsionalitas
yang sudah jalan (Kasir, Admin, Customer, Accounting) tidak berubah perilaku
sampai fitur "katalog Entity + Gunakan/Aktifkan" benar-benar dipakai.

## Open decisions milik Bos Cyo (bukan keputusan teknis)

1. **Kalau nama/foto/resep diedit di satu Store, apakah harus otomatis berubah
   di semua Store lain yang pakai barang yang sama?** Desain di atas mendukung
   ini (baca dari `product_masters` sebagai sumber tunggal), tapi itu berarti
   Admin Gerai manapun bisa mengubah tampilan barang milik Store lain secara
   tidak langsung. Alternatifnya: snapshot sekali saat "Gunakan" (lebih aman,
   tapi bukan single-source-of-truth murni). Ini keputusan bisnis, bukan
   arsitektur.
2. **Siapa yang boleh membuat/mengedit isi Master Barang Entity** — Admin Gerai
   pembuat saja, atau juga Entity Admin/Owner? (Pola yang sama sudah ada untuk
   Employee: Admin Gerai boleh lihat semua, tapi cuma boleh ubah yang gerainya
   sendiri rekrut — kemungkinan pola yang sama cocok di sini.)
3. **Resep/BOM dan klasifikasi (item_type/product_kind/unit)** — apakah target
   akhirnya juga jadi Entity-owned (barang "identik" antar-Store benar-benar
   satu resep), atau cukup dicocokkan per-Store seperti sekarang? Fase 1 di
   atas sengaja menunda ini; kalau jawabannya "ya, harus Entity-owned juga",
   itu ADR terpisah karena menyentuh Accounting/Costing.

## Yang sengaja tidak dikerjakan di sini

Tidak ada migration yang ditulis, tidak ada endpoint yang diubah. Sesuai
instruksi eksplisit Bos Cyo: audit dan mapping dulu. Setelah tiga open decision
di atas dijawab, langkah berikutnya adalah menulis task brief untuk Karen
(pola `agent-task-brief`) yang memecah proposal di atas jadi migration +
endpoint + test terpisah.

## DOC-IMPACT

**REQUIRED** — begitu Bos Cyo menjawab open decisions dan implementasi mulai:
`README.md` (Master Barang jadi konsep Entity-level), `KNOWN_PITFALLS.md`
(catatan "products di-clone per store lewat natural key" pindah status jadi
"legacy, digantikan product_masters"), `MODULE_OWNERSHIP.md` kalau ada modul
baru yang memilikinya.
