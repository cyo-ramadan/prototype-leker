# Known Issues — Prototype Leker

## Approval posting contract — resolved by V1

The posting-contract blocker introduced with approval queue 0013 is resolved by:

- `contracts/operational-posting-v1.md`;
- ADR-010;
- migration `0014_operational_posting_ledgers.sql`;
- `src/operational-posting.js`.

Current behavior:

- Kasir entry remains `pending_approval` + `unposted`;
- Admin Gerai can ACC/Reject only within its store;
- Owner can ACC/Reject across stores;
- ACC atomically writes the V1 domain movement and marks the approval `approved` + `posted`;
- failed non-negative stock/asset checks roll back the full batch and leave the request pending;
- CASH_FLOW affects drawer expected cash only after posting;
- GOODS_FLOW updates stock only after posting;
- ASSET updates aggregate asset-value ledger/balance only after posting.

V1 intentionally does not define lot/expiry or individual asset depreciation.

### Active: Auto Permit toggle (2026-09-04)

Governed by ADR-041 (amends ADR-009 point 8), migration `0066_store_approval_settings.sql`,
`src/approval-queue.js`, `public/management-approval-queue.js`.

Per-store toggle: when on, a cashier's new `approval_requests` submission is
posted immediately through the same `applyAccDecision()` contract a human ACC
uses (`rejectStaleStockAdjustment` → `buildOperationalPostingStatements` →
`env.DB.batch` → `cashFlowAccountingAfterCommit`), instead of waiting as
`pending_approval`. Scope is `approval_requests` only — `transaction_void_permits`
(Hapus/correction permits) is explicitly not affected.

- `approved_by_role = 'AUTO_PERMIT'`, `approved_by_id` = the account that
  turned the toggle on (`store_approval_settings.enabled_by_id`), never the
  submitting cashier — this is the accountability trail Bos Cyo asked for.
- A stale `STOCK_ADJUSTMENT` snapshot is still rejected exactly as it is
  today under manual ACC. Any other posting failure leaves the row
  `pending_approval`/`unposted` (the batch rolls back atomically) rather than
  being silently rejected — a human can still review it normally.
- Toggle read/write (`GET`/`PATCH /api/management/approval-settings`) is
  gated by the same store-scoped `managementScope()` every other approval
  endpoint uses: Admin Gerai own store, Owner any store, Entity Admin stores
  within its Entity.
- UI lives only in the per-store Admin panel tab (`mountBranchAdmin()`), not
  Owner's cross-store approval list, since the toggle has no meaning without
  a single store in context. Turning it on requires an explicit confirmation
  naming the consequence.

## Manufacturing, stock, production, and moving-average HPP

Current behavior is governed by:

- `contracts/manufacturing-master-v1.md`;
- `contracts/stock-production-points-v2.md`;
- ADR-012, ADR-013, and ADR-015;
- migrations `0016_manufacturing_master_v1.sql`, `0017_product_stock_production_points.sql`, `0019_product_costing_and_kinds.sql`, and `0021_exact_production_costing.sql`;
- `src/manufacturing-master.js` and `src/stock-production.js`.

Current behavior:

- the legacy inventory engine still persists physical stock and recipe quantities as integer values;
- the approved MAXI canonical direction is fractional-capable exact decimal quantity; a dedicated compatibility migration remains required before changing the inventory source of truth;
- `inventory_stock_balances` is the current quantity source and `stock_movements` is the auditable movement history;
- manual Produksi and the legacy AUTO_DADAKAN path use the same production engine;
- tracked stock may not become negative through guarded stock-out execution, but historical/legacy balance anomalies can still exist and must not be silently repaired;
- inventory purchases are itemized, select Product IDs from the store database, expose Qty explicitly, and create PURCHASE stock-in movements;
- `products.average_cost` is the running HPP source;
- `products.last_purchase_price` updates automatically from the newest itemized purchase;
- new authoritative unit-cost/HPP values use scaled INTEGER with `1,000,000` cost units per rupiah;
- purchase rows snapshot scaled average cost before/after;
- production components and runs use `*_scaled` exact integer HPP fields;
- legacy production REAL cost columns remain read-only history fallback and are not written by the new engine;
- sale items snapshot scaled unit HPP and line COGS so history is not recomputed from current master values;
- new Stock Adjustment requests snapshot exact scaled unit/total HPP in their immutable approval payload without becoming an `average_cost` writer;
- Admin has dedicated Stok and lazy transaction-detail read models.

### Open: canonical fractional inventory quantity migration

Current stock balances, stock movements, recipe quantities, purchase inventory quantities, sale quantities, and production quantities still use the legacy integer representation.

The approved target is one exact fractional-capable quantity model for all physical inventory, with unit-level decimal-scale validation. This requires a dedicated migration/compatibility plan so legacy quantity columns are not silently reinterpreted and no dual stock source is created.

Operational expense quantity is already stored as canonical decimal text because it is behavioural metadata and does not change inventory stock.

### Open: store-level HPP integrity policy for negative stock

Bos Cyo approved the product direction that each store/POS may have its own transaction-integrity policies. The first planned policy is conceptually:

`blockPurchaseWhenStockNegative`

Desired behavior when enabled:

- before a cost-affecting purchase posts, Inventory/Costing checks the current stock balance for every purchased item;
- if any current balance is `< 0`, the entire purchase is rejected with an explicit product/current-balance error rather than partially posting;
- the user must correct stock through Penyesuaian Stok until the balance is at least `0`, then retry the purchase;
- the purpose is to prevent a negative-stock anomaly from being silently absorbed into a new moving-average HPP baseline.

Ownership note: this policy belongs to Inventory/Costing even if surfaced from a shared Settings UI such as a `Policy Integritas HPP` section near Setting Akuntansi. Accounting must not become the owner of stock/HPP mutation rules.

The audited Penyesuaian Stok path is now active, so the former operational-deadlock dependency is resolved. The store-level negative-stock purchase toggle itself is still not implemented and must remain OFF/nonexistent until its own contract/tests are added.

### Active: audited Penyesuaian Stok

Cashier Penyesuaian Stok now reuses the Approval Queue and canonical inventory source:

- cashier chooses a tracked Product Master item and target physical quantity;
- server snapshots current stock, derives IN/OUT delta, and records exact `unitCostSnapshotScaled` + `totalCostSnapshotScaled` valuation evidence;
- Admin/Owner ACC rechecks the snapshot;
- stale requests fail closed without stock mutation;
- successful ACC updates `inventory_stock_balances`, inventory ledger evidence, and `stock_movements` atomically;
- no second stock table/source is created;
- V2 never rewrites Average Cost/HPP merely because quantity is corrected;
- HPP changes after staging leave the older payload untouched, while the next adjustment snapshots the new HPP;
- legacy V1 payloads remain quantity-only history and are never backfilled from today's Product Master HPP.

### Open: Sale-level fulfillment migration

Mode Pemenuhan is no longer editable in Master Barang. The legacy `products.production_mode` column remains temporarily because existing sale execution still reads it.

A future Sale contract must move fulfillment ownership to the Penjualan transaction and define the requested default `DADAKAN`. Until that versioned migration is implemented, do not delete or reinterpret the legacy column and do not silently change existing sale behavior.

### Open: Production V2 editable execution form

Bos Cyo defined the next Production interaction:

- choose output item from Product Master and enter actual output Qty;
- allow multiple dynamic raw-material rows selected from Product Master with editable Qty;
- optionally select a Recipe to populate an editable template rather than locking the form;
- snapshot the final edited output/material quantities as the actual production fact;
- calculate output HPP from exact material snapshots plus explicitly configured production-cost allocations;
- keep Bahan Baku and Biaya Produksi as distinct audit components;
- Accounting normally reclassifies inventory value from input inventory to output inventory rather than treating production as immediate profit/loss;
- any capitalization/reclassification of already-recorded operational expense must be explicit to avoid double-counting.

Production V1 remains recipe + batch driven until this separate contract/migration is implemented.

## Product Master, Jenis Barang, Purchase Qty, and Operational Qty

Current behavior is governed by:

- `contracts/product-master-accounting-reference-v4.md`;
- ADR-015, ADR-024, and ADR-025;
- migrations `0019_product_costing_and_kinds.sql`, `0020_expense_quantity_behavior.sql`, and `0021_exact_production_costing.sql`.

Current behavior:

- Master Barang edits product identity, Tipe Barang, Jenis Barang, Satuan Dasar, points, stock tracking, and Recipe Linked;
- Harga Beli is an editable Master Barang default and is used by the cashier purchase composer;
- Average Cost and Harga Beli Terakhir are automatic read-only fields; before the first purchase, the UI may show Harga Beli master as the temporary last-price fallback without creating transaction evidence;
- Jenis Barang is a separate user-defined classification with stable code and no invented seed values;
- Recipe Linked is explicit and same-store/output validated;
- Product Master writes may assign only `purchase_price`; `average_cost` and `last_purchase_price` remain server-owned;
- Item Type is presented as Peran Barang; Product Kind is presented as optional Klasifikasi Accounting;
- Product Master PATCH is sparse, preserves omitted technical references, and refreshes reference options after Peran/Satuan writes;
- Beli Bahan selects products from the active store Product Master database and requires explicit Qty per line;
- Pengeluaran Operasional stores explicit Qty, default `1`, as customer-behaviour metadata while its amount remains the total expense value;
- operational Qty alone never posts stock.

## Accounting Settings and Warehouse Settings

Current settings behavior is governed by:

- `contracts/accounting-settings-v1.md`;
- `contracts/warehouse-settings-v1.md`;
- ADR-016 and ADR-017;
- migration `0022_accounting_warehouse_settings.sql`;
- `src/accounting-settings.js`;
- `src/warehouse-settings.js`.

Implemented configuration:

- canonical local `chart_of_accounts`, `payment_methods`, `item_categories`, `transaction_categories`, and `journal_rules`;
- account references are selected by Setting Akuntansi, while account creation/maintenance belongs to Akuntansi;
- Payment Methods select accounts from COA data;
- Jenis Barang links to Inventory/HPP/Revenue accounts through `item_categories`;
- transaction categories can contain multiple ordered Debit/Credit rule rows;
- structural `Lengkap` requires at least one active Debit and one active Credit;
- cash-flow and goods-flow counterpart presets are available as Accounting configuration aids rather than a second mapping engine;
- Warehouse Settings owns warehouse/location, staff access, and stock-opname parameters;
- Warehouse registers `wh_transfer`, `wh_opname`, `wh_production`, and `wh_return` into Accounting `transaction_categories`;
- Warehouse has no account-mapping table;
- adjustment accounts `4201 Pendapatan Koreksi Stok` and `6103 Beban Susut Persediaan` are marked `review_required=1`;
- `wh_return` remains deliberately without default rules until return direction/subtype is defined;
- old provisional pair-mapping writer is retired.

Warehouse master exists, but canonical physical stock remains store-scoped. Do not pretend a warehouse selector moves warehouse-level stock until the warehouse location ledger/source contract exists.

## Accounting Workspace and POS bridge — deployed live

Accounting Workspace, Setting Akuntansi, POS Accounting bridge, six-decimal Accounting precision, transaction-correction permits/Raport, configured Cashier payment/component inputs, and the approved Cash Flow bridge are deployed on the permanent Prototype Leker Worker. The remote dedicated D1 migration chain is applied through `0027_transaction_void_permits.sql`. Deployment evidence: Prototype Leker main `b15838c7766073d0faed6a6ba56f8a26c49fb727`, canonical `Workers Builds: prototype-leker-v2` SUCCESS, and shared live smoke run `31781391476` SUCCESS.

Current behavior is governed by:

- `contracts/accounting-workspace-v1.md`;
- `contracts/accounting-pos-bridge-v1.md`;
- ADR-018 and ADR-019;
- migrations `0024_accounting_workspace.sql`, `0025_accounting_pos_bridge.sql`, and `0026_accounting_six_decimal_precision.sql`;
- `src/accounting-ledger.js`;
- `src/accounting-workspace.js`;
- `src/accounting-pos-bridge.js`;
- `src/accounting-pos-bridge-response.js`.

Implemented Accounting work:

- Akuntansi and Setting Akuntansi are separate top-level capabilities;
- Akuntansi can create accounts with server-generated unique codes;
- manual journals and system/POS journals share one posted-journal source;
- posted journal headers and lines are immutable;
- duplicate idempotency keys return the original journal;
- Data Jurnal exposes manual and bridge-generated journal sources;
- Buku Besar uses posted journal lines with normal-side running balances;
- Rugi Laba is period-scoped and uses posted Revenue/Expense balances;
- Neraca uses posted balances through the requested date plus current cumulative earnings;
- exact Accounting journal amounts use scaled INTEGER at `1 rupiah = 1,000,000` units;
- exact decimal inputs are rounded half-up at digit 7 to a maximum of 6 decimal places;
- journal line amounts remain positive with explicit Debit/Credit sides, while derived account/report balances may be negative and retain their sign;
- manual journals must balance exactly;
- non-manual system journals may explicitly request the approved `AUTO_EQUITY_UP_TO_100_RUPIAH` policy;
- a system imbalance `<= Rp100.000000` is closed with one auditable system-generated Equity line to the dedicated `Penyesuaian` account;
- an imbalance greater than Rp100 fails closed.

Implemented POS bridge:

- committed `SALE`, `PURCHASE`, and `EXPENSE` facts are dispatched after POS commit;
- the bridge reads `payment_methods`, `item_categories`, `transaction_categories`, and `journal_rules` rather than accepting account choices from POS;
- delivery status is stored in `accounting_bridge_deliveries`, which is reconciliation state and not a mapping table;
- missing mapping returns `NEEDS_CONFIGURATION` without rolling back the operational POS fact;
- retry is idempotent by source fact;
- Transaction Explorer reads actual bridge delivery status/journal reference for SALE/PURCHASE/EXPENSE;
- manual sync is reconciliation/retry only; normal POS posting remains automatic;
- sale `item_category_cogs` and sale-side `item_category_inventory` use the snapshotted `sale_items.line_cogs` scaled value directly;
- missing sale COGS snapshot fails closed with `NEEDS_COST_SNAPSHOT` rather than recomputing from current Product Master cost.

### Active: dynamic payment methods

Cashier sale, purchase, and operational-expense inputs load active `payment_methods` through the POS Core boundary. The POS fact carries the selected method code and never carries an Account ID or Debit/Credit decision. The legacy management surface still lives on the Accounting Settings route while the broader ADR-038 variable-provider refactor is pending; cashier validation no longer imports the Accounting bridge.

- only `CASH` is classified as physical drawer cash;
- every other active method is non-cash for drawer reconciliation;
- legacy `NON_CASH` remains an explicit compatibility payment component and intentionally has no default account mapping;
- inactive or unknown method codes fail closed before the POS fact is written.
- an active method with `account_id = NULL` remains valid for the POS fact; only the post-commit Accounting delivery reports `NEEDS_PAYMENT_MAPPING`.

### Active: operational component selection

The cashier UI selects one configured Debit expense component by `journalRuleId` without carrying an Account ID. If exactly one active component exists, it is selected automatically. Multiple Debit components require an explicit selection and fail `NEEDS_COMPONENT_SELECTION` when it is absent.

### Active: approved Cash Flow bridge

Approved and posted `CASH_FLOW` facts are delivered post-commit through `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1`. `IN` resolves `cash_flow_in`, `OUT` resolves `cash_flow_out`, and V1 settles through the configured active `CASH` payment method. Cashier counterpart choices and their default are canonical `journal_rules` managed by Setting Akuntansi. Missing configuration never rolls back the operational ACC; delivery remains reconcilable and retryable with the same idempotency identity.

### Open: Stock Opname rule branch semantics

The default `wh_opname` category contains labeled gain and loss rule rows. A future Warehouse-to-Accounting bridge must choose the correct branch from the actual signed adjustment and must never execute all four rows blindly. The two adjustment accounts require owner review before posting is enabled.

### Open: return taxonomy

`wh_return` is registered but fail-closed. Supplier return, customer return, and internal return can have different Accounting meaning, so no default rule is invented yet.

## Transaction correction permit + cashier Raport — active implementation

Governed by:

- `contracts/transaction-void-permit-v1.md`;
- `contracts/staff-raport-facts-v1.md`;
- ADR-022;
- migration `0027_transaction_void_permits.sql`;
- `src/transaction-void-permits.js`;
- `src/transaction-correction-executor.js`;
- `src/accounting-pos-reversal.js`;
- `src/accounting-reconciliation-guard.js`;
- `src/staff-raport.js`.

Active behavior:

- Cashier Hapus for committed SALE/PURCHASE/EXPENSE creates an approval permit with mandatory reason rather than hard-deleting history;
- Admin Gerai/Owner ACC or Reject from the existing Approval Queue surface;
- until ACC, original transaction remains fully active;
- approved Operational Expense correction soft-deletes the source and reconciles drawer/accounting;
- normal-stock Sale correction returns stock using the original exact sale COGS snapshot, reverses earned points, soft-deletes source, and reverses any POSTED Accounting journal;
- Sale with generated AUTO_DADAKAN production remains explicit `HOLD` until production-correction meaning is decided;
- Purchase correction runs only when no later dependent stock/cost history exists; otherwise it remains explicit HOLD without rewriting downstream HPP;
- Accounting reversal uses the same positive exact line amounts as the original journal with Debit/Credit sides swapped; negative journal-line amounts are not introduced;
- corrected source facts are excluded from later manual POS Accounting reconciliation;
- Transaction Explorer preserves corrected facts as history with `voided` state;
- Staff/Admin Raport exposes raw integrity facts from correction requests, decisions, drawer discrepancy and related operational data;
- no automatic fraud label or opaque KPI score is generated.

### Open: KPI score/grade policy

Raport facts are available, but score/grade remain `NEEDS_KPI_POLICY`. Bos Cyo still needs to define evaluation period, weights, target/direction, thresholds, and whether individual signals affect integrity score, operational score, or both.

### Open: AUTO_DADAKAN Sale correction meaning

If a Sale generated a production run, the correction executor currently HOLDs. Required business decision: should deleting/correcting the Sale also reverse that production run, or should produced goods remain as inventory? The system must not guess this because the two choices produce different stock/HPP history.

## Legacy business-fact seam

`MAXI_ACCOUNTING_BUSINESS_FACT_V1` is superseded for SALE/PURCHASE/EXPENSE by `MAXI_ACCOUNTING_POS_BRIDGE_V1`.

The old helper remains only for operational fact kinds that have not yet migrated to an active bridge. The shared `@maxi/accounting@1.3.0` service is still not deployed; the current Accounting implementation is a Prototype Leker composition host with an explicit future adapter boundary.

## Portal Staf

Live-photo attendance is active for authenticated cashier/employee sessions. The shared staff read model also supplies personal Raport/KPI facts. Riwayat Setoran dan Riwayat Gaji remain isolated empty portal sections until their own versioned data contracts are implemented.

### Active: presensi wajib sebelum buka laci, tiga state login kasir (2026-09-04)

Dua akun kasir gerai yang sama boleh login DAN presensi bersamaan (tidak pernah diblok sejak
awal — satu kredensial memang punya satu sesi server, tapi itu tidak mencegah akun BERBEDA
login bareng). Yang tetap eksklusif -- **tidak berubah dan sengaja tidak diubah** -- adalah
ENTRY: hanya kasir yang membuka laci yang boleh menulis transaksi (`requireDrawerOwner`,
`DRAWER_OWNED_BY_OTHER` untuk yang bukan pemegang laci persis). Percobaan pertama sesi ini
sempat melonggarkan ini jadi "siapa pun kasir aktif boleh menulis" berdasarkan salah tangkap
laporan Workboard (`tsk_0e79e1a9`, `tsk_4868f56f`, CS Pendem diblok "laci dipegang kasir pendem"
saat mau input Purchase/Sale) — **dikoreksi balik hari yang sama oleh Bos Cyo**: yang salah
bukan aturan entry-nya, tapi kasir lain waktu itu belum pernah dapat jalur buat presensi dan
tidak jelas boleh apa saja sebelum buka laci sendiri.

Model yang benar, tiga state akun kasir yang login:

1. **Login saja** — belum presensi, dashboard kasir (`#cashierDashboard`) belum ditampilkan.
2. **Login + presensi masuk** — dashboard sudah bisa dilihat; kalau laci gerai masih kosong,
   kasir ini sekarang boleh membukanya (baru boleh setelah presensi -- itu yang berubah). Kalau
   laci gerai sudah dipegang kasir lain, tetap read-only seperti sebelumnya.
3. **Login + presensi + buka laci sendiri** — write mode penuh, sama seperti desain lama.

Implementasi: `src/cashier-auth.js` expose `latestAttendanceStatus(db, cashierId)` (dipakai juga
oleh `/api/cashier/me` dan `/login` buat field `attendanceStatus`, toggle `'in'`/`'out'`
berdasarkan baris `staff_attendance` terakhir milik kasir itu, bukan penanda per-hari-kalender —
sengaja, supaya tidak perlu menebak timezone gerai). `src/cashier-drawer.js`'s
`POST /api/cashier/drawer/open` sekarang menolak (`403 PRESENSI_REQUIRED`) kalau
`latestAttendanceStatus` belum `'in'`. Endpoint transaksi (sale/purchase/expense/production/
approval-request/dll) semuanya tetap pakai `requireDrawerOwner` seperti sebelumnya — TIDAK ada
`requireOpenDrawer` atau mode "bantu" di kode ini; kalau ada yang menemukan sisa referensi itu,
itu bug regresi dari percobaan pertama yang sudah dikoreksi, bukan desain final.

Workflow login juga berubah: setelah login, kasir sekarang wajib presensi masuk (foto lewat
`CameraSnapshotModal`, endpoint `POST /api/staff/attendance` yang sudah ada sejak Portal Staf)
sebelum dashboard kasir ditampilkan — sebelumnya presensi murni opsional lewat halaman Portal
Staf terpisah (`/staff`), tidak pernah dipaksa. `public/cashier-presensi-gate.js` (dimuat
setelah `cashier-workspace.js`) membungkus `openDashboard` yang sedang aktif: setiap kali
dipanggil, dia cek ulang `GET /api/cashier/me`, dan hanya lanjut ke dashboard asli kalau
`attendanceStatus === 'in'`; kalau belum, tampilkan `#cashierPresensiGate` dulu.

Test runtime (bukan cuma cek string source) ada di
`test/cashier-drawer-helper-and-presensi.test.js`: buka laci ditolak `403 PRESENSI_REQUIRED`
sebelum presensi lalu berhasil sesudahnya, kasir kedua yang sudah login+presensi tetap ditolak
`403 DRAWER_OWNED_BY_OTHER` saat mencoba menulis expense, laci kedua tetap ditolak dibuka
(`409 DRAWER_ALREADY_OPEN`), dan `attendanceStatus` di `/api/cashier/me` mengikuti baris
`staff_attendance` terakhir yang sebenarnya di-insert ke DB.

### Active: presensi jadi toggle in/out, plus GPS+timestamp, plus tombol Workboard (2026-09-04)

Tiga hal terpisah yang Bos Cyo minta di putaran yang sama:

1. **Presensi masuk/keluar sekarang toggle state yang ditegakkan server-side**, bukan cuma dua
   tombol independen. `POST /api/staff/attendance` (`src/staff-portal.js`) menolak `type=in`
   kalau `latestAttendanceStatus` sudah `'in'` (`409 ALREADY_CHECKED_IN`), dan menolak `type=out`
   kalau belum pernah/tidak sedang `'in'` (`409 NOT_CHECKED_IN`). `public/staff.js` juga
   men-disable tombol yang tidak valid berdasarkan `attendanceStatus` yang sekarang ikut dibalas
   `GET /api/staff/portal`.
2. **Foto presensi sekarang boleh menyertakan lokasi GPS + akurasi**, direkam sendiri (bukan
   add-on/SaaS pihak ketiga) lewat `navigator.geolocation.getCurrentPosition` di
   `public/camera-snapshot-modal.js` (opt-in lewat `CameraSnapshotModal.open({watermark:true})`,
   timeout 6 detik, gagal-lunak ke `null` kalau ditolak/tidak tersedia -- presensi tetap boleh
   jalan tanpa koordinat, foto tetap wajib). Ada dua bentuk bukti: (a) watermark visual dibakar
   langsung ke pixel foto (bar semi-transparan di bawah, isi timestamp lokal + koordinat) supaya
   kelihatan langsung saat foto dilihat manusia, dan (b) `latitude`/`longitude`/
   `location_accuracy_meters` disimpan sebagai kolom terpisah di `staff_attendance` (migration
   `0067`, nullable, `REAL` -- ini koordinat geografis bukan uang, tidak kena invariant scaled-integer)
   supaya bisa diquery, bukan cuma terkubur di dalam gambar. Dipakai di kedua jalur presensi
   masuk: `public/staff.js` (Portal Staf) dan `public/cashier-presensi-gate.js` (gerbang wajib
   abis login) -- drawer-close (`cashier-live-photo.js`) sengaja TIDAK ikut diberi watermark,
   di luar permintaan.
3. **Tombol "🗂️ Maxi Store Workboard" ditambahkan di header Portal Staf** (`public/staff.html`),
   link keluar biasa (`target="_blank"`) ke `program-task.daily-napkin.workers.dev` -- TIDAK ada
   integrasi data/auth apa pun, cuma tombol. Fitur "abis presensi otomatis nongol daily task
   milik sendiri dari Workboard, bisa dikasih task tambahan dari Admin, ada pembatasan role buat
   CS (cuma boleh minta respon, tidak bisa bikin task)" -- itu semua **sengaja ditahan (hold)**
   atas instruksi eksplisit Bos Cyo sampai ada keputusan lanjutan "bikin sendiri di Leker vs
   sambung ke Workboard yang sudah ada" (opsi pertama direkomendasikan Hana: isolated dari
   produk lain, konsisten dengan keputusan "Workboard integration -- on hold" yang sudah ada di
   bagian lain dokumen ini; belum diputuskan Bos Cyo).
4. **Satu baris `staff_attendance` sekarang menjelaskan satu sesi kerja penuh** (masuk + pulang),
   bukan dua baris event terpisah seperti sebelumnya -- Bos Cyo minta ini supaya ada satu tempat
   yang bisa ditambah detail lain nanti (jumlah task dikerjakan, jam kerja, gaji per jam, dst;
   kolom-kolom itu sendiri **belum** dibuat, cuma bentuk barisnya yang disiapkan). Migration
   `0068`: kolom lama (`created_at`/`photo_type`/`latitude`/`longitude`/`location_accuracy_meters`)
   sekarang berarti fakta presensi MASUK; kolom `check_out_*` baru berarti fakta presensi PULANG
   di baris yang sama; kolom `status` (`OPEN` = sudah masuk belum pulang, `CLOSED` = sudah pulang)
   menggantikan `attendance_type` sebagai penentu status aktif (`latestAttendanceStatus` di
   `src/cashier-auth.js` sekarang cek "ada baris `status='OPEN'`", bukan lagi "tipe baris
   terakhir"). Presensi masuk = INSERT baris baru (`status='OPEN'`); presensi pulang = UPDATE
   baris `OPEN` yang sama (`status='CLOSED'`) -- **foto tetap wajib dan tetap tersimpan di kedua
   sisi** (masuk maupun pulang), cuma sekarang di satu baris, bukan cerita baru. 8 baris lama di
   production (format event-log lama) di-backfill otomatis oleh migration (`status` diisi dari
   `attendance_type` masing-masing baris secara independen -- data lama tidak punya pasangan
   masuk/pulang yang jelas untuk dipasangkan ulang secara otomatis, jadi dibiarkan sebagai baris
   historis apa adanya, tidak dihapus). `src/staff-raport.js`'s ringkasan presensi juga ikut
   berubah bentuk dari `{total, checkIn, checkOut}` jadi `{total, closed, open}`.

Test runtime ada di `test/staff-attendance-toggle-geolocation.test.js`: urutan toggle in→out→in
(termasuk penolakan out-sebelum-in dan in-dobel), koordinat GPS tersimpan lewat jalur multipart
form yang sama seperti production (`readLivePhoto`), koordinat null-safe kalau field GPS tidak
dikirim sama sekali (ditemukan lewat test ini: `coord()` versi pertama salah mengubah `null`
jadi `0` lewat `Number(null)` -- dikoreksi sebelum sempat dipakai, lihat riwayat commit), dan
migration `0068` benar-benar diuji dengan menerapkan migration itu sendirian di atas DB yang
sudah berisi baris format lama (bukan cuma cek isi file migration) untuk membuktikan backfill-nya
jalan.

## Detail Laci

### Active: keterangan buka laci + nomor urut Laci #N (2026-09-04)

Bos Cyo minta pola yang sama dengan presensi diterapkan juga ke laci: satu baris `cash_drawer_sessions`
sudah menjelaskan satu sesi laci penuh sejak awal (buka + tutup di baris yang sama, tidak perlu
direstruktur seperti `staff_attendance`), tapi baru sisi TUTUP yang punya kolom keterangan
(`closing_note`, sudah tampil sebagai "Keterangan Pulang" di render Detail Laci). Migration
`0069` menambahkan `opening_note` (pola sama: `TEXT NOT NULL DEFAULT ''`) supaya kasir yang buka
laci juga bisa isi catatan opsional (mis. kondisi modal awal shift), tampil sebagai "Keterangan
Buka" di render yang sama (`public/drawer-report-ui.js`, dipakai bareng oleh Kasir dan Admin/Owner
-- satu perubahan otomatis nongol di kedua tempat). Daftar riwayat laci di kasir
(`public/cashier-enhancements.js`, dialog "📚 Detail Laci") sebelumnya cuma menampilkan ID laci
mentah; sekarang dilabeli "Laci #N" berurutan dari yang paling lama (`#1`) ke yang paling baru,
dihitung dari posisi di array `ORDER BY opened_at DESC` yang sudah dikembalikan server (`total -
index`) -- bukan kolom baru, murni derivasi tampilan. Baris riwayat juga menampilkan preview
kedua keterangan (buka & pulang) kalau diisi.

Test runtime + static ada di `test/drawer-opening-note.test.js`: `POST /api/cashier/drawer/open`
dengan `openingNote` benar-benar tersimpan dan kebaca balik lewat `GET /api/cashier/drawer`,
default kosong kalau tidak diisi (pola sama dengan `closing_note`), dan wiring UI (textarea di
dialog Buka Laci, penomoran `Laci #N`, kedua label keterangan) diverifikasi lewat regex terhadap
source file yang sebenarnya, bukan diasumsikan.

### Fixed shape: saldo awal laci read-only, melanjutkan saldo akhir laci sebelumnya (2026-09-04)

Bos Cyo mencoba dua desain lain di hari yang sama sebelum menetap di ini -- riwayatnya penting
buat agen lain supaya tidak mengulang salah satu desain yang sudah ditolak:
1. Entry manual + auto-permit ke Approval Queue kalau beda dari saldo akhir laci sebelumnya
   (ditolak).
2. Desain (1) plus ACC pada permit-nya langsung memposting jurnal kas (kategori Jenis Transaksi
   `drawer_shortage`/`drawer_surplus`, migration 0070) -- juga ditolak, di hari yang sama juga.

**Bentuk final:** saldo awal laci **read-only**, otomatis melanjutkan `closing_amount` laci CLOSED
terakhir di gerai yang sama -- server yang menentukan nilainya (`getLastClosedDrawer` di
`src/cashier-drawer.js`), bukan sekadar field yang dikunci di UI: input `openingAmount` dari client
DIABAIKAN kalau ada laci sebelumnya yang sudah CLOSED. Kalau kas fisik ternyata tidak cocok dengan
angka itu, itu **dibahas kasir langsung dengan akuntan di luar sistem ini** -- akuntan yang bikin
jurnalnya sendiri lewat jurnal manual (fitur yang sudah ada), atau lewat permit Arus Kas yang sudah
ada dan memang perlu ACC akuntan. Tidak ada lagi permit otomatis, tidak ada lagi kategori Jenis
Transaksi khusus, tidak ada posting jurnal otomatis dari sisi ini sama sekali.

Laci pertama di sebuah gerai (belum pernah ada laci CLOSED) tetap entry manual, karena tidak ada
"kemarin" untuk dilanjutkan.

**Migration 0071 membongkar scaffolding 0070:** migration 0070 (desain kedua di atas) sudah
sempat `applied` di production sebelum ditolak -- CLAUDE.md invariant #7 melarang menulis ulang
migration yang sudah applied, jadi 0071 adalah migration forward baru yang menghapus trigger dan
baris `transaction_categories`/`journal_rules` yang 0070 buat (`drawer_shortage`, `drawer_surplus`),
tanpa menyentuh `coa_<store>_4202` ("Pendapatan Lainnya") karena akun itu dipakai bersama sebagai
default `cash_flow_in` sejak migration 0028, bukan milik 0070. Satu `approval_requests` row nyata
dari sempat hidupnya desain kedua (purpose `DRAWER_OPENING_DISCREPANCY`, di salah satu gerai pilot,
`pending_approval`) sengaja dibiarkan apa adanya -- itu data kejadian nyata, bukan sesuatu yang
dihapus lewat migration. ACC pada baris itu sekarang gagal aman (constraint `cash_ledger_entries`
menolak payload lama yang tidak punya `direction`/`amount`, karena `buildOperationalPostingStatements`
sudah kembali ke bentuk normal); Admin/Owner tinggal Reject baris itu lewat Approval Queue.

Terpisah dari ini: kolom `opening_note` (section di atas) tetap ada dan independen -- kasir bisa
isi keterangan buka laci apa pun nominalnya cocok atau tidak.

Test runtime + static ada di `test/drawer-opening-discrepancy.test.js`: `GET /api/cashier/drawer`
mengembalikan `lastClosingAmount` (null kalau belum pernah ada laci CLOSED), `POST .../drawer/open`
mengabaikan `openingAmount` dari client dan memakai `closing_amount` laci sebelumnya kalau ada,
laci pertama di gerai tetap terima entry manual, tidak ada `approval_requests` yang pernah dibuat
lagi untuk ini, dialog buka laci di kasir merender field read-only kalau ada saldo sebelumnya, dan
migration 0071 dicek baik secara statis maupun lewat reproduksi in-memory penuh (gerai baru tidak
lagi dapat `drawer_shortage`/`drawer_surplus`, gerai lama yang sempat ke-seed migration 0070
bersih kembali, `cash_flow_in`/`cash_flow_out` dan akun bersama `coa_4202` tidak terganggu).

## Master Karyawan: orang dipisahkan dari akun login (2026-09-04)

Sampai sebelum ini, identitas karyawan cuma kolom teks yang nempel di tiap tabel akun
(`cashiers.employee_name`, `store_admins.display_name`). Akibatnya satu orang yang memegang dua
username di dua gerai tercatat sebagai dua orang yang tidak berhubungan, dan begitu sebuah
username dioper ke karyawan pengganti, jejak siapa yang dulu memegangnya hilang total.

Migration 0072 memisahkan keduanya:

- **`employees`** — satu baris per MANUSIA, dimiliki **Entity** (badan usaha), bukan gerai.
  Perekrutnya boleh gerai (`home_store_id` terisi) atau Entity langsung (`home_store_id` NULL,
  untuk karyawan yang tidak menempel gerai mana pun seperti OB kantor). Ini pelebaran
  lintas-gerai yang disengaja dan disetujui Bos Cyo: majikan yang sebenarnya memang Entity.
  Isolasi tetap dijaga server-side di lapisan API — gerai hanya melihat karyawan di bawah
  entity-nya sendiri.
- **`employee_account_links`** — siapa memegang akun apa, **dari kapan sampai kapan**.
  Berjangka waktu, bukan kolom pointer yang ditimpa. Ini inti desainnya: riwayat keuangan yang
  sudah terjadi (gaji, setoran, hutang) harus tetap menempel ke orang yang memegang username itu
  SAAT kejadian, bukan ikut berpindah diam-diam ke pemegang berikutnya. Pola persis
  `entity_tenancy` (migration 0039): tutup periode lama dengan `effective_to`, buka baris baru,
  tidak pernah meng-UPDATE hubungan lama (dijaga trigger `trg_employee_link_history_immutable`).

Aturan yang ditegakkan schema + API:
- Satu orang boleh memegang beberapa username sekaligus di gerai berbeda (kasus nyata: CS yang
  membackup gerai kosong) — tapi satu username hanya boleh punya SATU pemegang aktif, dijaga
  unique index parsial `idx_employee_link_one_active_holder`.
- Link tidak boleh menyeberang entity, dan akun yang ditunjuk harus benar-benar ada di
  gerai/entity yang diklaim (`trg_employee_link_scope_insert`, pola sama dengan
  `trg_journal_rule_scope_insert`).
- Gerai boleh MELIHAT semua karyawan se-entity (supaya bisa menautkan CS backup), tapi hanya
  boleh MENGUBAH/menonaktifkan karyawan yang gerainya sendiri yang merekrut. Karyawan tingkat
  Entity hanya bisa dibuat Owner/Entity Admin.
- Karyawan yang masih memegang username tidak bisa dinonaktifkan — lepas tautannya dulu.

`effective_from`/`effective_to` memakai timestamp ISO milidetik dari aplikasi, **bukan**
`CURRENT_TIMESTAMP` SQLite: resolusinya cuma detik dan formatnya beda (`'YYYY-MM-DD HH:MM:SS'`
vs ISO), dan mencampur dua format di kolom yang diurutkan sebagai teks bikin urutan riwayat
salah. CHECK-nya sengaja `>=` bukan `>` — salah tautkan lalu langsung dilepas di detik yang sama
itu koreksi wajar, dan periode nol-detik tetap riwayat yang sah (ditemukan lewat test, bukan
dugaan).

Panelnya ada di **Workspace Admin Gerai** (tab Karyawan, `public/admin-employees.js`), bukan di
layar kasir — kasir cuma jadi sumber fakta otomatis nantinya, dia tidak mengurus data karyawan.

**Belum dikerjakan (menyusul di atas fondasi ini):** Panel Hutang-Piutang Karyawan (pemilik data,
jurnal cuma turunan, pintu jurnal manual ke akun kontrolnya ditutup), akun/peran Sidak beserta
jalur Penyesuaian Stok lintas gerai tanpa syarat laci kebuka, panel sisi Entity dan Tenant, serta
lapisan penugasan "satu orang pegang sebagian gerai di bawah entity". Peran **Superadmin** masih
menunggu keputusan Bos Cyo soal levelnya (di dalam satu Entity, atau lintas semua pelanggan di
tingkat platform) — belum dibuat karena dua pilihan itu beda posisi di struktur.

Test ada di `test/employee-master.test.js`.

## Staff session dan duplicate tab

Canonical login remains separated into Pelanggan and Karyawan, one staff account has one active server session, and one browser has one active staff tab through the local browser lease. Customer sessions remain separate.

If browser-tab lease or takeover creates a new failure, record a new issue and do not restore tight periodic polling as a workaround.

## Fixed: new-store provisioning was silently broken in production (2026-08-25)

Found while provisioning three new Leker stores (Kantor/Pendem/Mandala, migration 0052):
`INSERT INTO stores` for `edition='ACCOUNTING'` failed with `ITEM_CATEGORY_SCOPE_MISMATCH`,
the exact bug migration 0048 documented and claimed to fix. Root cause, confirmed by
reading `sqlite_schema` directly rather than trusting the `d1_migrations` ledger
(CLAUDE.md invariant #7): the trigger 0048 was supposed to install
(`trg_payment_methods_seed_raw_material_product_kind`) did not exist in production,
while the broken trigger 0048 said to retire (`trg_stores_seed_raw_material_product_kind`)
was still live — and that trigger does not appear in any migration file in git history
(`git log --all -S` returns nothing), meaning it was created by hand directly against
production and never recorded. Fixed additively in migration 0053 (drop the undocumented
trigger, re-install 0048's trigger verbatim) and verified against a disposable test store
before touching real data. This affected every new-store creation path (this migration,
`src/admin-multistore.js`, `src/owner-auth.js`), not just this one.

## Workboard integration — on hold (2026-09-04)

MAXI Workboard (D1 `maxi-workboard-prototype`, UI `program-task.daily-napkin.workers.dev`)
is a **cross-product prototype/sample**, not Leker-owned and not yet a finished product.
It is used by more than Leker's own agents/staff. This section records what was discussed
and decided about integrating it with Leker, so the next round does not start from zero.

Discussed and decided:

- Bos Cyo wants Workboard's task/issue/finding data to eventually feed Leker's existing
  Raport/KPI feature as employee performance assessment, and wants Leker staff to have
  sidak (inspection)/finding-recording features with tracked results.
- Bos Cyo's own proposed identity model (not yet built): a master employee-**name** table,
  connected to multiple "**employed**" records — one person can have several employments,
  one employment = one company's access grant. Raport is fundamentally scoped by employee
  name, extendable to name+company. Confirmed **not** a prerequisite for the Entity Admin
  panel (below), which shipped independently.
- **Where sidak findings get stored** (Workboard vs Leker vs Leker-as-source/Workboard-as-
  reader) is still **undecided** — explicitly deferred by Bos Cyo pending further
  brainstorming.
- Three-tier access hierarchy Bos Cyo described: Store Admin (single-store, existing) →
  Entity Admin (new, multi-store within one Entity, entity-wide accounting/sidak reach) →
  Tenant (Bos Cyo, all Entities). **Entity Admin panel is now built and live** (migration
  0063, `src/owner-auth.js` `handleEntityAdminApi`/`requireManagement` `ENTITY_ADMIN`
  branch, `public/entity-admin.html`/`.js`; percontohan accounts Rika/Alfina under grouped
  Entity `ENT-KPM` — Kantor/Pendem/Mandala, migration 0064).
  Workboard's task/issue/finding visibility was described as needing to mirror this same
  three-tier structure (Store-scoped view inside Store panels, but the sidak/inspector
  role's home workspace and broader reach lives at Entity level, Tenant level spans all
  Entities) — **not yet implemented**, this is the shape a future Workboard-Leker bridge
  should follow once the storage-location decision above is made.
- Architecture question — should Workboard's codebase be merged into Leker's repo?
  **No.** Recommendation given and not objected to: keep Workboard a separate product,
  connect through a small read/write API bridge scoped by store (similar in shape to
  `agent-bridge/`, a separate Worker), rather than merging codebases or forking a parallel
  Portal Staf implementation inside Leker. Rationale: Workboard already has working
  task/issue/announcement plumbing used across products; a native Leker rebuild would
  duplicate that and fragment cross-product visibility into two boards that can drift.
- Workboard's own `organization_entities`/`organization_stores` tables (which structurally
  mirror Leker's Entity/Store shape) were checked and found **completely empty** — not
  just for the newly grouped Kantor/Pendem/Mandala, but for every store including ones
  already actively used (e.g. Pendem). Workboard's `users` and `employees` tables have
  **no column** linking them to those org tables or to any store/entity id today, so
  populating those tables right now would not connect to anything functional yet. This was
  explored (not executed) while looking for what "siapkan perangkat Workboard untuk gerai
  ini" should concretely mean.
- **Explicit sequencing decision (2026-09-04):** this whole topic is **on hold**. Priority
  is finishing Leker's own debugging/functional-check pass (`tsk_hana_admin_gerai_functional_check`
  in Workboard, assigned to the accountant) until real CS/store staff can actually use the
  product end to end. Workboard integration resumes after that — explicitly **not**
  starting over, this section is the resume point.

## Leker store roster (as of 2026-08-25)

Six stores across two tenants, confirmed live: `store_001` (Leker Mall Dinoyo),
`store_ab5c6dd4-...` (MAXI LEKER DINOYO), `store_002` (MAXI LEKER G002), `store_kantor`
(Kantor), `store_pendem` (Pendem), `store_mandala` (Mandala) — all `TEN-PROTOTYPE`,
`edition='ACCOUNTING'`; plus `store_ikan01` (Galeh) under `TEN-GALEH`, `edition='LITE'`.
Bos Cyo asked for at least 10 Leker stores; 7 more names are needed to reach that count.

As of 2026-09-04, Kantor/Pendem/Mandala no longer each have their own Entity — migration
0064 grouped them under one new Entity `ENT-KPM` (see the Entity Admin panel note above)
so an Entity Admin can pick between them without re-logging in. Their original per-store
entities (`ENT-KANTOR`/`ENT-PENDEM`/`ENT-MANDALA`) still exist but now own zero stores;
they were deliberately not deleted because Pendem's pre-existing posted journal/stock
history snapshots `entity_id` at write time (migration 0046) and still points at
`ENT-PENDEM`.

## DOC-IMPACT

**REQUIRED** — Product Master/costing contracts, Accounting Settings/Warehouse Settings, Accounting Workspace/POS Bridge, configured Cashier payment/component inputs, Cash Flow bridge, audited Stock Adjustment, transaction correction permits/Raport, migrations through 0027, deployment evidence, button audit, and regression/live-smoke tests must describe the active implementation state. Remaining major work includes fractional inventory quantity migration, Sale fulfillment migration, Production V2 editable execution, store-level negative-stock purchase policy, warehouse-level stock routing, Goods Flow valuation, Warehouse-to-Accounting posting semantics, return taxonomy, KPI scoring policy, Deposit, and Payroll transaction implementations. Also update when: the Entity Admin panel gains a creation UI or an entity-level consolidated accounting/sidak view (currently migration-seeded accounts only, single-store read/write reuse of `branch-admin.html`); the Workboard integration hold above is lifted or its storage-location/hierarchy decisions are made; the Auto Permit toggle's scope extends beyond `approval_requests` (e.g. to `transaction_void_permits`) or gains a per-request-type granularity; the presensi-before-drawer-open gate or the mandatory post-login presensi gate change shape; the `staff_attendance` shift-row shape grows the deferred detail columns (task counts, hours, pay); or the Detail Laci opening-note/Laci #N numbering changes shape; or the read-only saldo-awal-laci continuation is compared against Accounting's ledger cash balance instead of the previous drawer's `closing_amount`, or a mismatch-handling mechanism (permit, flag, or posting) is reintroduced for it; or the Master Karyawan layer grows its dependents — the Employee Payable/Receivable panel (with the manual-journal door closed on its control accounts), the Sidak role and its drawer-free cross-store Stock Adjustment path, Entity/Tenant-side employee panels, the "one person covers a subset of stores under one entity" assignment layer, or the Superadmin role once its level (entity-scoped vs platform-wide) is decided.
