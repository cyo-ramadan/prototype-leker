# Audit STEP1 — source variable Pembayaran dan Biaya

Status: COMPLETE (read-only audit)
Date: 2026-08-21
Task: `karen-SA-AUDIT-PEMBAYARAN-BIAYA`
Baseline: `9a656cf03253a0056433b339e6867ac8cdaca1bb`
Rujukan keputusan: `adr/ADR-038-setting-transaksi-variable-reference-module.md`
Dikerjakan oleh: `karen1.1`

## 1. Scope dan metode

Audit ini memeriksa sumber nyata untuk:

1. Metode Pembayaran POS;
2. Master Biaya beserta Jenis Biaya dan Kelompok Biaya;
3. kasus bernama "Bi Ijah".

Untuk setiap kandidat variable, audit membedakan `IDENTITY`, `DISPLAY`,
`OWNER MODULE`, `SOURCE OF TRUTH`, `ACTIVE/INACTIVE LIFECYCLE`, dan
`RUNTIME FACT FIELD`. Bukti berasal dari schema, migration, runtime, API, dan
test pada baseline di atas. Audit tidak mengubah source code, migration,
runtime behavior, maupun data D1.

Pencarian nama dilakukan secara repository-wide, case-insensitive:

```sh
rg -n -i "bi[ _-]?ijah|ijah" .
```

Hasil pada baseline: **0 match**.

## 2. Ringkasan hasil

| Kandidat sumber | Kesimpulan STEP1 | Provider readiness | Blocker/gap utama |
|---|---|---|---|
| Metode Pembayaran POS | Variable nyata; registry dan runtime reader sudah berada di boundary POS Core | **READY WITH GAPS** | writer/UI masih di route Setting Akuntansi; Account masih satu tabel; fact menyimpan `code`, bukan `id` |
| Master Biaya | Variable nyata milik Operasional dengan ID stabil dan lifecycle soft-active | **REGISTRY READY, FACT PROVENANCE BLOCKED** | `costMasterId` hilang setelah expense disimpan; bridge tidak bisa memulihkan source identity |
| Jenis Biaya | Master pendukung nyata dengan `id`, `code`, `name`, dan status | **PARTIAL** | tidak ada writer publik; seed hanya menyediakan tipe untuk `store_001` |
| Kelompok Biaya | String/tag tampilan pada setiap Master Biaya | **NOT AN IDENTITY** | free-form, mutable, tidak punya registry atau lifecycle sendiri |
| "Bi Ijah" | Tidak ada row, seed, enum, test, atau special behavior di repository | **ABSENT** | Setting Transaksi dilarang mengarang variable yang belum ada di source module |

## 3. Metode Pembayaran POS

### 3.1 Pemisahan enam dimensi

| Dimensi | Temuan | Bukti |
|---|---|---|
| `IDENTITY` | Row `payment_methods.id`, diakses dalam scope `store_id`. `code` unik per gerai dan dipertahankan oleh writer saat PATCH, tetapi immutability-nya belum dijaga constraint database. Untuk `VariableReference`, identity tetap ID row; code hanya kandidat `sourceCode`. | `migrations/0022_accounting_warehouse_settings.sql:24-36`; `src/accounting-settings.js:505-522` |
| `DISPLAY` | `name`. Nama boleh diubah saat PATCH dan unik per gerai. | `migrations/0022_accounting_warehouse_settings.sql:28-36`; `src/accounting-settings.js:509-522` |
| `OWNER MODULE` | Target keputusan ADR-038 adalah POS Core. Runtime reader/resolver sudah ada di `src/pos-payment-methods.js`, tetapi maintenance writer dan UI masih transitional di Setting Akuntansi. | `adr/ADR-038-setting-transaksi-variable-reference-module.md:24-25,51-55,87-88`; `src/pos-payment-methods.js:1-2`; `src/accounting-settings.js:830-832`; `public/admin-accounting-settings-comfort.js:123-157` |
| `SOURCE OF TRUTH` | Tabel store-scoped `payment_methods`. POS reader hanya membaca `id`, `code`, `name`, default, dan status aktif; reader tidak mengambil `account_id`. | `migrations/0022_accounting_warehouse_settings.sql:24-37`; `src/pos-payment-methods.js:10-27,30-53` |
| `ACTIVE/INACTIVE LIFECYCLE` | Soft lifecycle melalui `is_active`; POS hanya mengeluarkan/menerima row aktif. Satu metode aktif dapat menjadi default; route yang tersedia hanya POST/PATCH, tidak ada DELETE. | `migrations/0022_accounting_warehouse_settings.sql:30`; `migrations/0029_purchase_accounting_defaults.sql:3-8`; `src/pos-payment-methods.js:15-20,42-47`; `src/accounting-settings.js:511-518,830-832` |
| `RUNTIME FACT FIELD` | SALE, PURCHASE, dan EXPENSE menyimpan **payment method code** di `payment_method`; snapshot Accounting menyimpan canonical `payment_method_code`. Resolver mengetahui ID saat request, tetapi ID tidak ikut disimpan ke fact. | `src/cashier-sales-tracking.js:85-92,150-158`; `src/cashier-purchase.js:161-174`; `src/cashier-operational-expense.js:72-86,113-142`; `src/accounting-reference.js:76-103` |

### 3.2 Registry dan perilaku internal POS

Registry awal menyediakan `CASH`, `BANK`, dan `PAYABLE` untuk setiap gerai,
serta `RECEIVABLE_OFFSET` dalam keadaan inactive. Compatibility migration juga
menambahkan `NON_CASH` active tanpa Account. Seed dan trigger-nya terlihat di:

- `migrations/0022_accounting_warehouse_settings.sql:302-308,408-410`;
- `migrations/0029_purchase_accounting_defaults.sql:10-20,65-72`;
- `migrations/0025_accounting_pos_bridge.sql:55-65`.

POS workspace mengambil daftar melalui `listPosPaymentMethods()` dan mengirim
hasilnya ke browser (`src/cashier-workspace.js:1-20`; `public/cashier-workspace.js:1-18`).
Daftar canonical browser memakai code/name dari payload, bukan daftar buatan
Setting Transaksi (`public/cashier-payment-methods.js:4-18,57-64,153-164`).

Satu-satunya behavior kas fisik yang ditemukan adalah **exact code `CASH`**:

- provider memberi `usesCashDrawer: row.code === 'CASH'`
  (`src/pos-payment-methods.js:21-27,48-53`);
- drawer report memasukkan semua code selain `CASH` ke kelompok non-cash
  (`src/drawer-report.js:132-137`).

`BANK`, `PAYABLE`, `NON_CASH`, dan `RECEIVABLE_OFFSET` tidak memiliki behavior
POS khusus lain di runtime transaksi yang diaudit. Makna Account mereka adalah
concern Accounting, diselesaikan setelah fact commit.

### 3.3 Boundary Accounting sesudah commit

Accounting melakukan lookup ulang berdasarkan `paymentMethodCode`, lalu membaca
`account_id` (`src/accounting-pos-bridge.js:199-218`). Bila transaksi memakai
rule payment dan row tidak ada, hasilnya `NEEDS_PAYMENT_METHOD`; bila row ada
tetapi Account belum terpasang, hasilnya `NEEDS_PAYMENT_MAPPING`
(`src/accounting-pos-bridge.js:403-408`). Ini tidak membatalkan fact POS yang
sudah committed.

Regression test membuktikan metode aktif tanpa Account tetap diterima POS dan
Accounting fail-closed setelahnya (`test/accounting-pos-bridge.test.js:110-152`;
`test/operational-accounting-boundary.test.js:67-116`).

### 3.4 Gap yang harus dibawa ke STEP2

1. **Writer ownership masih transitional.** Runtime sudah POS-owned, tetapi
   create/edit masih berada di `/api/admin/settings/accounting/payment-methods`
   dan UI masih meminta Account dalam form yang sama
   (`src/accounting-settings.js:505-533,830-832`;
   `public/admin-accounting-settings-comfort.js:123-157`).
2. **Account masih co-located.** `payment_methods.account_id` berada di source
   table, sedangkan ADR-038 meminta Account menjadi extension terpisah
   (`migrations/0022_accounting_warehouse_settings.sql:24-36`;
   `adr/ADR-038-setting-transaksi-variable-reference-module.md:87-88`).
3. **Fact memakai code, bukan stable ID.** Current writer tidak mengubah code
   saat PATCH, sehingga lookup code masih deterministic melalui API resmi.
   Namun durability `VariableReference(sourceId=id)` belum tersnapshot di fact.
4. **Legacy browser fallbacks masih hardcoded.** `public/cashier-enhancements.js`
   masih memiliki opsi statis `CASH/NON_CASH` dan `CASH/BANK/PAYABLE`
   (`public/cashier-enhancements.js:8-13,182-196,199-225`). Canonical payment
   script dimuat lebih dulu (`public/cashier.html:116-120`), tetapi duplicate
   daftar ini tetap menjadi drift risk dan tidak boleh dijadikan provider.

## 4. Master Biaya

### 4.1 Pemisahan enam dimensi

| Dimensi | Temuan | Bukti |
|---|---|---|
| `IDENTITY` | `cost_masters.id`, store-scoped. ID dibuat sekali saat POST dan dipertahankan saat PATCH. | `migrations/0038_operational_accounting_boundary.sql:93-107`; `src/cost-master.js:89-118` |
| `DISPLAY` | `name` adalah label utama. `contact`, nominal default, `costTypeName`, dan `costGroup` adalah metadata/display; semuanya dapat berubah tanpa mengganti ID. | `migrations/0038_operational_accounting_boundary.sql:93-107`; `src/cost-master.js:34-56,59-71,105-118` |
| `OWNER MODULE` | Operasional/business master. Cost Master tidak memilih Accounting rule. | `migrations/0038_operational_accounting_boundary.sql:78-79`; `adr/ADR-029-operational-accounting-boundary.md:19-27,31-34`; `MODULE_OWNERSHIP.md:17` |
| `SOURCE OF TRUTH` | `cost_masters`, dengan FK ke `cost_types`. Cashier provider hanya mengeluarkan master dan tipe yang sama-sama aktif. | `migrations/0038_operational_accounting_boundary.sql:80-108`; `src/cost-master.js:34-56,74-87` |
| `ACTIVE/INACTIVE LIFECYCLE` | Soft lifecycle `is_active` pada master dan tipe. POST/PATCH tersedia, DELETE tidak ada. Master tidak valid untuk transaksi bila master atau tipenya inactive. | `migrations/0038_operational_accounting_boundary.sql:80-107`; `src/cost-master.js:41-42,69-70,89-120`; `src/cashier-operational-expense.js:50-67` |
| `RUNTIME FACT FIELD` | Request memakai `items[].costMasterId`; response mengembalikan `costMasterId`, `costTypeId`, dan `costGroup`. Row `expenses` hanya menyimpan snapshot `description = master.name`, amount, quantity, dan payment code. Tidak ada `cost_master_id` atau `cost_type_id` pada fact. | `src/cashier-operational-expense.js:43-67,72-99`; `migrations/0038_operational_accounting_boundary.sql:33-53` |

### 4.2 Temuan kritis — source identity hilang setelah commit

Alur current runtime adalah:

1. request membawa `costMasterId`;
2. runtime memvalidasi ID terhadap master dan tipe yang aktif;
3. insert expense menyimpan `item.master.name` sebagai `description`;
4. ID master/type hanya ada di response in-memory;
5. Accounting Bridge kemudian reload expense tanpa ID master/type dan membentuk
   `itemLines: []`.

Bukti langkah 1–4 ada di `src/cashier-operational-expense.js:43-99`; reload
bridge ada di `src/accounting-pos-bridge.js:133-150`.

Akibatnya, resolver asynchronous/retry tidak bisa membentuk ulang identity
`sourceModule + sourceType + sourceId` untuk Master Biaya dari fact tersimpan.
Nama di `description` adalah snapshot display lama, bukan identity: rename
Master Biaya setelah transaksi tidak mengubah expense lama dan dua master tidak
bisa dibedakan dengan aman dari string display saja.

Ini adalah blocker untuk mapping berbasis `VariableReference(COST_MASTER)` pada
post-commit Accounting. STEP2 perlu menetapkan durable fact provenance sebelum
Master Biaya dipakai sebagai komponen transaksi source-referenced. Audit ini
tidak menetapkan bentuk schema/contract perbaikannya.

### 4.3 Jenis Biaya dan Kelompok Biaya

`cost_types` memiliki bentuk master yang layak direferensikan: `id`, `code`,
`name`, dan `is_active` (`migrations/0038_operational_accounting_boundary.sql:80-91`;
`src/cost-master.js:18-31`). Namun baseline hanya menulis seed `DELIVERY` dan
`PACKAGING` untuk `store_001`; tidak ditemukan POST/PATCH untuk `cost_types`
atau trigger seed gerai baru (`migrations/0034_cost_master.sql:37-69`). Karena
create/update Master Biaya mewajibkan active store-local cost type
(`src/cost-master.js:59-71`), gerai tanpa tipe tidak dapat membuat master baru
melalui API resmi.

`cost_group` adalah TEXT wajib pada row Master Biaya dan editable melalui PATCH
(`migrations/0038_operational_accounting_boundary.sql:100-105`;
`src/cost-master.js:59-71,110-117`). Ia tidak memiliki ID, code, registry,
unique constraint, atau lifecycle sendiri. Karena itu `cost_group` hanya cocok
sebagai tag/display metadata, bukan `VariableReference.sourceId`.

## 5. Kasus "Bi Ijah"

Repository-wide search menemukan **tidak ada** literal `Bi Ijah`, variasi
separator/case-nya, maupun `Ijah`. Tidak ada seed, enum, fixture, test, atau
branch behavior yang dapat membuktikan bahwa "Bi Ijah" adalah variable source.

Kesimpulan audit:

1. "Bi Ijah" **tidak boleh** dibuat sebagai option bebas di Setting Transaksi,
   sesuai larangan ADR-038 terhadap variable rekaan
   (`adr/ADR-038-setting-transaksi-variable-reference-module.md:12-19`).
2. Bila operator kelak membuat payment method bernama literal `Bi Ijah` melalui
   writer yang ada, writer generik akan menghasilkan code `BI_IJAH`, membuat ID
   UUID, dan memperlakukannya seperti metode biasa
   (`src/accounting-settings.js:21-25,505-533`). Ini observasi mekanis, bukan bukti row
   tersebut ada pada baseline.
3. Jika row hipotetis itu aktif, POS akan menerimanya. Karena code-nya bukan
   `CASH`, drawer menganggapnya non-cash. Bila `account_id` kosong dan rule
   Accounting memerlukan payment source, post-commit result menjadi
   `NEEDS_PAYMENT_MAPPING`. Tidak ada special internal behavior bernama
   "Bi Ijah".

## 6. Input faktual untuk Variable Provider Contract STEP2

Tabel ini adalah candidate mapping dari source yang benar-benar ada. Nama enum
final dan mekanisme push/pull tetap open menurut ADR-038 §4; audit tidak
menetapkannya sepihak.

| Candidate | `sourceModule` candidate | `sourceType` candidate | `sourceId` | `sourceCode` | `displayName` | `status` | Catatan |
|---|---|---|---|---|---|---|---|
| Payment method | POS | `PAYMENT_METHOD` | `payment_methods.id` | `payment_methods.code` | `payment_methods.name` | `ACTIVE`/`INACTIVE` dari `is_active` | `CASH` membawa capability cash-drawer; Account bukan data provider POS |
| Cost Master | OPERASIONAL / BUSINESS_SETTINGS | `COST_MASTER` | `cost_masters.id` | `null` pada schema sekarang | `cost_masters.name` | `ACTIVE`/`INACTIVE`, efektif active hanya bila tipenya active | Blocked untuk post-commit sampai source ID durable di fact |
| Cost Type, bila STEP2 memerlukannya | OPERASIONAL / BUSINESS_SETTINGS | `COST_TYPE` | `cost_types.id` | `cost_types.code` | `cost_types.name` | `ACTIVE`/`INACTIVE` | Provider bootstrap/writer belum lengkap |

Contract STEP2 perlu menyelesaikan pertanyaan berikut dari evidence audit:

1. enum canonical untuk source module Operasional/Business Settings;
2. cara menyimpan atau merekam snapshot stable payment method ID dan Cost Master ID
   pada transaction fact tanpa membuat POS bergantung pada Setting Transaksi;
3. pemisahan payment Account extension dari source table POS;
4. lifecycle/history saat source inactive atau display berubah;
5. provider cost type untuk semua gerai;
6. penghapusan duplicate hardcoded payment option sebagai source palsu.

## 7. Verification dan change boundary

- repository-wide search "Bi Ijah": 0 match;
- schema/runtime/API/test evidence dikutip dengan path dan line;
- source files changed: **NONE**;
- migration files changed: **NONE**;
- production D1 mutation: **NONE**;
- output: dokumen audit ini saja.

## DOC-IMPACT

**NONE untuk runtime.** Dokumen ini adalah evidence input STEP1. Setelah ketiga
audit STEP1 selesai, hasilnya harus dipakai untuk menulis Variable Provider
Contract STEP2 dan kemudian sinkronisasi contract/ADR yang diwajibkan ADR-038.
