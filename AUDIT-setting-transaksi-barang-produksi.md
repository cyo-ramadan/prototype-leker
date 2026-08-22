# Audit STEP1 — source variable Barang, Warehouse, dan Produksi

Status: COMPLETE (read-only audit)
Date: 2026-08-21
Task: `karen-SA-AUDIT-BARANG-PRODUKSI`
Baseline: `2c605a7440dde922690a804c4c9f2c43f42a72ed`
Rujukan keputusan: `adr/ADR-038-setting-transaksi-variable-reference-module.md`
Dikerjakan oleh: `karen1.1`

## 1. Scope dan metode

Audit ini memeriksa source variable nyata untuk:

1. Product/Master Barang dan tiga klasifikasi yang mudah tertukar: Kategori
   Menu, Tipe Barang, dan Jenis Barang;
2. Warehouse/location master serta fakta stock yang tersedia hari ini;
3. Recipe revision, production execution, dan Product Kind snapshot yang
   dikonsumsi Accounting.

Untuk setiap kandidat audit membedakan `IDENTITY`, `DISPLAY`, `OWNER MODULE`,
`SOURCE OF TRUTH`, `ACTIVE/INACTIVE LIFECYCLE`, dan `RUNTIME FACT FIELD`.
Semua kesimpulan berasal dari schema, runtime, API, contract, ADR, dan test pada
baseline di atas. Audit tidak mengubah source code, migration, runtime behavior,
atau data D1.

## 2. Empat konsep Barang yang tidak boleh dicampur

| Konsep | Bentuk current source | Fungsi nyata | Layak menjadi identity VariableReference? |
|---|---|---|---|
| Product / Master Barang | `products.id` | Identitas barang konkret yang dijual, dibeli, diproduksi, atau dikonsumsi | **YA**, bila STEP2 membutuhkan rule per barang |
| Kategori Menu | `products.category` TEXT; tabel `categories` terpisah tetapi Product tidak menyimpan `category_id` | Pengelompokan tampilan/menu | **TIDAK dalam bentuk sekarang**; relasi hanya string nama |
| Tipe Barang / Peran Barang | `item_types.id` + capability flags | Menentukan `can_sell`, `can_purchase`, `can_produce`, `can_consume`, dan stock tracking | **REGISTRY YA**, tetapi identity tipe tidak disnapshot ke transaction facts |
| Jenis Barang / Klasifikasi Accounting | `product_kinds.id` + stable `code` | Classification seam yang sudah dipakai Accounting | **YA**; provider paling siap dan sudah durable di facts |
| Item Category Accounting | `item_categories.id`, FK `product_kind_id`, Account IDs | Mapping extension dari Jenis Barang ke Account | **BUKAN source variable**; identity business tetap `product_kinds.id` |

Schema Product menyimpan `category` sebagai TEXT, sedangkan `categories` punya
ID sendiri tanpa FK dari Product (`migrations/0004_multi_store.sql:31-56`).
Product writer membuat row kategori dari nama bila belum ada dan tetap menulis
nama ke Product (`src/product-master.js:36-43,145-159,220-243`). Karena rename,
inactive state, atau duplicate semantic tidak terikat lewat ID, Kategori Menu
tidak boleh dipakai sebagai stable source identity pada STEP2.

## 3. Jenis Barang (`product_kinds`)

### 3.1 Pemisahan enam dimensi

| Dimensi | Temuan | Bukti |
|---|---|---|
| `IDENTITY` | `product_kinds.id`, store-scoped. `code` unik per gerai dan tidak diubah oleh PATCH API; identity VariableReference tetap ID, sedangkan code menjadi `sourceCode`. | `migrations/0019_product_costing_and_kinds.sql:3-18`; `src/product-kinds.js:55-71,74-97` |
| `DISPLAY` | `name`; editable tanpa mengganti ID/code. | `src/product-kinds.js:78-97` |
| `OWNER MODULE` | Source berada di Product Master/Inventory seam, bukan Setting Transaksi. ADR-038 menyebut Jenis Barang harus dibaca dari source POS/Inventory. | `contracts/product-master-accounting-reference-v2.md:9-25,45-53`; `MODULE_OWNERSHIP.md:19`; `adr/ADR-038-setting-transaksi-variable-reference-module.md:12-25` |
| `SOURCE OF TRUTH` | Tabel `product_kinds`. `item_categories` adalah Account-mapping extension yang menunjuk row ini, bukan registry business kedua. | `migrations/0019_product_costing_and_kinds.sql:3-18`; `migrations/0022_accounting_warehouse_settings.sql:39-56` |
| `ACTIVE/INACTIVE LIFECYCLE` | Soft state `is_active`; list provider mengembalikan active dan inactive. API hanya POST/PATCH, tidak ada DELETE. Product baru tidak boleh memilih kind inactive, tetapi Product yang sudah menunjuk kind itu boleh mempertahankannya. | `src/product-kinds.js:16-41,44-97`; `src/product-master.js:162-173` |
| `RUNTIME FACT FIELD` | SALE dan PURCHASE menyimpan `product_kind_id`, `product_kind_code`, dan `product_kind_name` per line. Production menyimpan snapshot yang sama untuk output dan setiap component. | `migrations/0019_product_costing_and_kinds.sql:62-84,112-120`; `migrations/0039_flexible_manual_production.sql:3-19`; `src/cashier-sales-tracking.js:95-113`; `src/cashier-purchase.js:94-117`; `src/warehouse-production.js:252-290` |

### 3.2 Current Accounting consumer

POS Accounting Bridge reload SALE/PURCHASE Product Kind snapshots dari fact,
kemudian resolve Account mapping berdasarkan `productKindId`
(`src/accounting-pos-bridge.js:71-130,222-236,410-452`). Warehouse Production
Bridge melakukan pola yang sama untuk output dan components
(`src/accounting-warehouse-production-bridge.js:64-130,192-241`).

Ini memenuhi invariant ADR-038: display dapat berubah pada source tanpa
memutus identity. Transaction lama tetap membawa ID/code/name saat commit,
sehingga rename atau reclassification Product berikutnya tidak menulis ulang
makna fact lama. Contract production juga menyatakannya eksplisit
(`contracts/stock-production-points-v3.md:68-83`).

### 3.3 `item_categories` adalah extension, bukan provider

`item_categories` memiliki ID, copy nama, active state, dan Account IDs sendiri
(`migrations/0022_accounting_warehouse_settings.sql:39-56`). Row dibuat otomatis
saat Product Kind baru diinsert (`migrations/0029_purchase_accounting_defaults.sql:51-63`).
Writer Setting Akuntansi kemudian mengubah Account mapping dan bahkan dapat
mengganti `product_kind_id` (`src/accounting-settings.js:536-568`).

Konsekuensi untuk STEP2:

1. komponen variable wajib memakai `sourceId = product_kinds.id`, bukan
   `item_categories.id`;
2. `item_categories.name` tidak boleh menjadi `displayName` source. Trigger
   hanya menyalin nama pada INSERT, sedangkan rename Product Kind tidak
   menyinkronkan copy itu (`src/product-kinds.js:78-97`);
3. Account IDs dan mapping lifecycle tetap concern extension Accounting/Setting
   Transaksi; source provider Product Kind tidak boleh mengeluarkannya sebagai
   ownership data;
4. pemisahan extension table tetap dibutuhkan sesuai ADR-038
   (`adr/ADR-038-setting-transaksi-variable-reference-module.md:87-88`).

### 3.4 Seed current main dan semantic warning

Migration awal menyatakan Product Kind user-defined dan tidak mengarang
business kind (`migrations/0019_product_costing_and_kinds.sql:3-4`). Keputusan
operasional yang lebih baru kemudian membuat satu `RAW_MATERIAL / Bahan Baku`
per gerai dan mengisinya ke semua Product yang belum terklasifikasi
(`migrations/0040_single_product_kind_and_sale_rules.sql:18-27,49-64,111-141`).

Artinya row `RAW_MATERIAL` saat ini nyata dan boleh dibaca provider, tetapi
code itu **tidak boleh ditafsirkan sebagai capability bahan baku**. Pada current
data ia juga dapat mewakili barang jadi yang sebelumnya belum punya kind.
Capability sell/purchase/produce/consume tetap berasal dari `item_types`, bukan
dari nama/code Product Kind. Active Product Master contract yang berkata
"No default Product Kind is invented" belum disinkronkan terhadap migration
0040 (`contracts/product-master-accounting-reference-v4.md:20-23`); ini doc
drift yang harus dibawa ke STEP2/doc sync.

### 3.5 Lifecycle gap

Product Kind dapat dibuat inactive tanpa guard terhadap Product aktif yang masih
menunjuknya. SALE, PURCHASE, dan Production query melakukan LEFT JOIN ke kind
tanpa syarat `k.is_active = 1`, sehingga transaksi baru masih dapat membawa
snapshot kind inactive (`src/cashier-sales-tracking.js:95-107`;
`src/cashier-purchase.js:27-45,94-117`;
`src/warehouse-production.js:59-82,117-144`).

Provider wajib tetap mengeluarkan tombstone/status inactive untuk historical
resolution. STEP2 juga harus menentukan apakah Product aktif yang masih linked
ke kind inactive boleh membuat fact baru, karena current source behavior
memperbolehkannya.

## 4. Product, Tipe Barang, dan Unit

### 4.1 Product / Master Barang

| Dimensi | Temuan |
|---|---|
| `IDENTITY` | `products.id` (INTEGER PK), diakses store-scoped; tidak memiliki stable business code. |
| `DISPLAY` | `products.name`; category, emoji, dan image adalah presentation metadata. |
| `OWNER MODULE` | Product Master / Inventory-Costing. |
| `SOURCE OF TRUTH` | `products`; operational references ke item type, product kind, unit, dan recipe. |
| `ACTIVE/INACTIVE LIFECYCLE` | Soft `is_active`; POST/PATCH writer, tanpa DELETE pada canonical Product editor. |
| `RUNTIME FACT FIELD` | `product_id` dan `product_name` tersimpan pada SALE, PURCHASE, Production output/components, dan `stock_movements`. |

Bukti schema/lifecycle: `migrations/0004_multi_store.sql:31-45` dan
`src/product-master.js:209-295`. Bukti fact: `src/cashier-sales-tracking.js:95-113`,
`migrations/0019_product_costing_and_kinds.sql:62-84`,
`migrations/0017_product_stock_production_points.sql:15-85`, dan
`src/warehouse-production.js:252-290`.

Product adalah candidate `PRODUCT` yang valid bila rule granularity per barang
memang dibutuhkan. Current Accounting resolver tidak memakai Product ID; ia
secara sengaja mengelompokkan lewat Product Kind. STEP2 tidak boleh mengganti
granularity itu diam-diam.

### 4.2 Tipe Barang / Peran Barang

`item_types` memiliki stable ID/code, editable display name, capability flags,
dan soft active state (`migrations/0016_manufacturing_master_v1.sql:3-19`;
`src/manufacturing-master.js:58-90,324-368`). Runtime memakai capability ini
untuk menentukan apakah Product boleh dijual, dibeli, diproduksi, dikonsumsi,
atau dilacak stoknya (`migrations/0016_manufacturing_master_v1.sql:238-259`;
`src/cashier-purchase.js:27-45`; `src/warehouse-production.js:59-82,117-144`).

Namun SALE/PURCHASE/Production facts tidak menyimpan `item_type_id` atau
capability snapshot. Re-query Product setelah commit akan membaca tipe terbaru,
bukan tipe saat transaksi. Maka registry `ITEM_TYPE` siap dibaca, tetapi
post-commit mapping berbasis tipe **belum mempunyai durable fact provenance**.
Ia tidak boleh dipakai menggantikan Product Kind pada STEP2 tanpa keputusan
snapshot/fact tambahan.

### 4.3 Unit

`units` adalah store-scoped master dengan ID/code, name/symbol, dan soft active
state (`migrations/0016_manufacturing_master_v1.sql:21-34`). API mendukung
POST/PATCH, mempertahankan ID/code, serta melarang perubahan unit dasar Product
setelah recipe/history stock/non-zero balance
(`src/manufacturing-master.js:370-409`; `src/product-master.js:120-142`).
SALE tidak menyimpan unit, tetapi PURCHASE dan Production menyimpan unit ID dan
symbol. Unit layak sebagai provider metadata bila contract memerlukannya; unit
bukan Account classification dan bukan pengganti Product Kind.

## 5. Warehouse/location

### 5.1 Pemisahan enam dimensi

| Dimensi | Temuan | Bukti |
|---|---|---|
| `IDENTITY` | `warehouses.id`, store-scoped. `code` unik dan dipertahankan saat PATCH. | `migrations/0022_accounting_warehouse_settings.sql:109-125`; `src/warehouse-settings.js:145-174` |
| `DISPLAY` | `name` dan `location_name`; keduanya editable tanpa mengganti ID/code. | `src/warehouse-settings.js:59-82,165-174` |
| `OWNER MODULE` | Contract menyebut Warehouse Settings; ia tidak memiliki Account mapping. Namun `MODULE_OWNERSHIP.md` masih menaruh `src/warehouse-settings.js` di baris `accounting-settings`, sehingga owner registry belum sinkron. | `contracts/warehouse-settings-v1.md:6-10,51-64`; `MODULE_OWNERSHIP.md:16` |
| `SOURCE OF TRUTH` | `warehouses`; `warehouse_access` dan `warehouse_stock_opname_settings` adalah capability/config extensions. | `migrations/0022_accounting_warehouse_settings.sql:109-160`; `contracts/warehouse-settings-v1.md:12-49` |
| `ACTIVE/INACTIVE LIFECYCLE` | Soft `is_active`; list mengembalikan seluruh row; POST/PATCH tersedia, tidak ada DELETE. | `src/warehouse-settings.js:59-82,145-174,260-274` |
| `RUNTIME FACT FIELD` | **NONE.** Tidak ada `warehouse_id` pada stock balance, stock movement, SALE, PURCHASE, stock adjustment, atau Production facts. | `migrations/0014_operational_posting_ledgers.sql:20-45`; `migrations/0017_product_stock_production_points.sql:15-85`; repository-wide `warehouse_id` search hanya menemukan settings/access/opname config |

### 5.2 Registry siap, execution belum ada

Warehouse API sudah mengeluarkan registry contract
`MAXI_WAREHOUSE_SETTINGS_V1` (`src/warehouse-settings.js:59-82,123-138`). Namun
canonical physical balance masih `(store_id, product_id)` dan movement hanya
membawa Product, direction, source, serta actor. Ia tidak membedakan gudang.

Contract Warehouse menyatakan stock movement/transfer/opname execution berada
di luar scope (`contracts/warehouse-settings-v1.md:113-124`). Accounting Flow
contract dan regression test karena itu menandai warehouse routing **HOLD**
(`contracts/accounting-flow-presets-v1.md:80-88`;
`test/accounting-flow-presets.test.js:37-43`).

Kesimpulan: Warehouse dapat menjadi provider untuk menampilkan pilihan nyata,
tetapi belum boleh dipasang sebagai variable yang mengklaim source/destination
transaction. STEP2 harus menunggu fact yang menyimpan `warehouse_id` dan model
stock location yang versioned. Nama file `warehouse-production.js` tidak menjadi
bukti lokasi gudang; Production fact di file itu juga tidak memiliki warehouse ID.

## 6. Produksi / Manufaktur

### 6.1 Recipe revision

| Dimensi | Temuan |
|---|---|
| `IDENTITY` | `manufacturing_recipes.id` mengidentifikasi **satu revision exact**. Setiap update membuat UUID baru; `(store_id, output_product_id, revision)` juga unik. |
| `DISPLAY` | Tidak ada recipe name/code. Display dibentuk dari output Product name + revision; notes hanya metadata. |
| `OWNER MODULE` | Current implementation Manufacturing Master/Produksi. ADR-037 mengarahkan Produksi diserap ke modul Manufaktur, tetapi status ADR masih PROPOSED. |
| `SOURCE OF TRUTH` | `manufacturing_recipes` + immutable `manufacturing_recipe_components`. |
| `ACTIVE/INACTIVE LIFECYCLE` | `ACTIVE`/`ARCHIVED`; maksimal satu active revision per output Product. Save mengarsipkan revision lama dan membuat row baru; archive explicit tersedia. |
| `RUNTIME FACT FIELD` | `production_runs.recipe_id` dan `recipe_revision` tersimpan bersama actual execution snapshot. |

Bukti schema: `migrations/0016_manufacturing_master_v1.sql:156-200`.
Bukti lifecycle/writer: `src/manufacturing-master.js:191-284,412-433`.
Bukti fact: `migrations/0017_product_stock_production_points.sql:15-43` dan
`src/warehouse-production.js:252-269,346-364`.

Recipe exact revision dapat menjadi candidate `RECIPE_REVISION`. Bila bisnis
ingin mapping yang mengikuti satu logical recipe melewati revisi, schema sekarang
tidak punya `recipe_family_id`: ID berubah pada setiap revision. `outputProductId`
bisa menjadi grouping fact, tetapi menjadikannya family identity adalah keputusan
contract STEP2, bukan sesuatu yang boleh disimpulkan audit.

### 6.2 Production execution fact

Production run menyimpan:

- `production_runs.id`, mode, output Product ID/name, unit ID/symbol, recipe ID
  + revision, actual output quantity, Product Kind ID/code/name, HPP snapshot,
  dan template-modified flag;
- component Product ID/name, unit ID/symbol, actual quantity, Product Kind
  ID/code/name, serta exact cost snapshot.

Bukti: `migrations/0017_product_stock_production_points.sql:15-63`,
`migrations/0021_exact_production_costing.sql:3-11`,
`migrations/0039_flexible_manual_production.sql:3-19`, dan
`src/warehouse-production.js:240-344`.

Current production-to-Accounting path hanya menggunakan Product Kind snapshot
dan exact component cost. Ia tidak memakai Recipe ID, Product ID, Item Type,
atau Warehouse ID sebagai mapping variable
(`src/accounting-warehouse-production-bridge.js:64-130,192-241`). Product Kind
karena itu **READY** untuk `wh_production`; variable production lain adalah
candidate future granularity dan tidak boleh diaktifkan otomatis.

### 6.3 Yang bukan registry variable hari ini

1. `production_runs.mode` (`AUTO_DADAKAN | MANUAL`) adalah enum pada transaction
   fact, bukan source master dengan ID/display/lifecycle.
2. `products.production_mode` adalah legacy compatibility state dan contract
   melarangnya menjadi configuration authority
   (`migrations/0017_product_stock_production_points.sql:3-7`;
   `contracts/product-master-accounting-reference-v2.md:55-61`).
3. Mode HPP `DIRECT_FROM_PURCHASE` dan `RECIPE_WEIGHTED_AVERAGE` baru proposal
   ADR-037 (`adr/ADR-037-manufacture-costing-authority.md:81-89`). Tidak ada
   schema/runtime/provider implementation pada baseline, sehingga Setting
   Transaksi tidak boleh membuat option tersebut sendiri.
4. HPP, quantity, `template_modified`, dan capability flags adalah fact values
   atau metadata. Mereka bukan stable identity `VariableReference`.

## 7. Input faktual untuk Variable Provider Contract STEP2

Nama enum final dan provider push/pull tetap keputusan STEP2. Tabel berikut
hanya memetakan source yang benar-benar ada.

| Candidate | `sourceModule` candidate | `sourceType` candidate | `sourceId` | `sourceCode` | `displayName` | `status` | Readiness |
|---|---|---|---|---|---|---|---|
| Product Kind | INVENTORY / PRODUCT_MASTER | `PRODUCT_KIND` | `product_kinds.id` | `product_kinds.code` | `product_kinds.name` | active/inactive | **READY**; durable snapshots sudah ada |
| Product | POS / PRODUCT_MASTER | `PRODUCT` | string form dari `products.id` | `null` | `products.name` | active/inactive | **READY IF NEEDED**; current Accounting granularity tetap Product Kind |
| Item Type | MANUFACTURE / PRODUCT_MASTER | `ITEM_TYPE` | `item_types.id` | `item_types.code` | `item_types.name` | active/inactive | **REGISTRY READY; FACT BLOCKED** |
| Unit | MANUFACTURE / PRODUCT_MASTER | `UNIT` | `units.id` | `units.code` | `units.name`/symbol | active/inactive | **METADATA READY** untuk PURCHASE/Production |
| Warehouse | WAREHOUSE | `WAREHOUSE` | `warehouses.id` | `warehouses.code` | `warehouses.name` | active/inactive | **REGISTRY READY; EXECUTION BLOCKED** |
| Recipe exact revision | MANUFACTURE | `RECIPE_REVISION` | `manufacturing_recipes.id` | revision number sebagai metadata, bukan code | output Product name + revision | active/archived | **FACT READY; FAMILY ID OPEN** |

Explicitly excluded as source variables:

- `item_categories.id` — Accounting mapping extension;
- `products.category` — free string link, bukan category identity;
- `cost/HPP/quantity/capability` — value/metadata;
- proposed manufacture modes — belum ada provider;
- warehouse source/destination — belum ada runtime fact.

## 8. Pertanyaan yang wajib diselesaikan STEP2

1. Canonical `sourceModule` names untuk Product Master/Inventory, Warehouse, dan
   Manufaktur; owner registry Warehouse saat ini belum sinkron.
2. Apakah Product-level rule dibutuhkan, atau Product Kind tetap granularity
   tunggal untuk tahap pertama.
3. Lifecycle rule saat active Product masih menunjuk inactive Product Kind.
4. Pemisahan `item_categories` menjadi Account extension keyed by Product Kind,
   termasuk menghapus duplicated display authority.
5. Apakah Item Type akan menjadi mapping variable; bila ya, bagaimana tipe saat
   transaction disnapshot secara durable.
6. Apakah Recipe mapping exact per revision atau mengikuti logical family; schema
   sekarang tidak punya stable family ID.
7. Warehouse harus tetap display-only/HOLD sampai stock location dan fact
   warehouse source/destination benar-benar ada.
8. Proposed manufacture HPP modes tidak boleh masuk provider sebelum source
   module mengimplementasikan registry/versioned contract sendiri.

## 9. Verification dan change boundary

- schema/runtime/API/contract/test evidence dikutip dengan path dan line;
- repository-wide `warehouse_id` search: hanya settings/access/opname config,
  tidak ada transaction fact;
- repository-wide implementation search untuk proposed HPP mode: 0 match pada
  `src`, `migrations`, `contracts`, dan `test`;
- source files changed: **NONE**;
- migration files changed: **NONE**;
- production D1 mutation: **NONE**;
- output: dokumen audit ini saja.

## DOC-IMPACT

**NONE untuk runtime.** Dokumen ini adalah evidence input STEP1. Temuan doc
drift Product Kind seed, owner Warehouse, dan provider/fact gaps harus dibawa ke
Variable Provider Contract STEP2 dan doc sync sesudah ketiga audit selesai.
