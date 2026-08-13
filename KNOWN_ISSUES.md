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

V1 intentionally does not define canonical Accounting journal generation, lot/expiry, or individual asset depreciation.

## Manufacturing, stock, production, and moving-average HPP

Current behavior is governed by:

- `contracts/manufacturing-master-v1.md`;
- `contracts/stock-production-points-v2.md`;
- ADR-012, ADR-013, and ADR-015;
- migrations `0016_manufacturing_master_v1.sql`, `0017_product_stock_production_points.sql`, `0019_product_costing_and_kinds.sql`, and `0021_exact_production_costing.sql`;
- `src/manufacturing-master.js` and `src/stock-production.js`.

Current behavior:

- the deployed/legacy inventory engine still persists physical stock and recipe quantities as integer values;
- the approved MAXI canonical direction is fractional-capable exact decimal quantity; a dedicated compatibility migration remains required before changing the inventory source of truth;
- `inventory_stock_balances` is the current quantity source and `stock_movements` is the auditable movement history;
- manual Produksi and the legacy AUTO_DADAKAN path use the same production engine;
- tracked stock may not become negative;
- inventory purchases are itemized, select Product IDs from the store database, expose Qty explicitly, and create PURCHASE stock-in movements;
- `products.average_cost` is the running HPP source;
- `products.last_purchase_price` updates automatically from the newest itemized purchase;
- new authoritative unit-cost/HPP values use scaled INTEGER with `1,000,000` cost units per rupiah;
- purchase rows snapshot scaled average cost before/after;
- production components and runs use `*_scaled` exact integer HPP fields;
- legacy production REAL cost columns remain read-only history fallback and are not written by the new engine;
- sale items snapshot scaled unit HPP and line COGS so history is not recomputed from current master values;
- Admin has dedicated Stok and lazy transaction-detail read models.

### Open: canonical fractional inventory quantity migration

Current stock balances, stock movements, recipe quantities, purchase inventory quantities, sale quantities, and production quantities still use the legacy integer representation.

The approved target is one exact fractional-capable quantity model for all physical inventory, with unit-level decimal-scale validation. This requires a dedicated migration/compatibility plan so legacy quantity columns are not silently reinterpreted and no dual stock source is created.

Operational expense quantity is already stored as canonical decimal text because it is behavioural metadata and does not change inventory stock.

### Still intentionally open: Sale-level fulfillment migration

Mode Pemenuhan is no longer editable in Master Barang. The legacy `products.production_mode` column remains temporarily because existing sale execution still reads it.

A future Sale contract must move fulfillment ownership to the Penjualan transaction and define the requested default `DADAKAN`. Until that versioned migration is implemented, do not delete or reinterpret the legacy column and do not silently change existing sale behavior.

### Still intentionally open: Penyesuaian Stok write contract

The cashier Penyesuaian Stok entry point remains inactive until an explicit adjustment reason/audit/approval contract is defined. Future adjustment posting must reuse `stock_movements` and must not bypass the stock audit model.

## Product Master, Jenis Barang, Purchase Qty, Operational Qty, and Accounting reference seam

Current behavior is governed by:

- `contracts/product-master-accounting-reference-v2.md`;
- ADR-015;
- migrations `0019_product_costing_and_kinds.sql`, `0020_expense_quantity_behavior.sql`, and `0021_exact_production_costing.sql` plus the provisional Accounting reference objects from migration 0018.

Current behavior:

- Master Barang edits product identity, Tipe Barang, Jenis Barang, Satuan Dasar, points, stock tracking, and Recipe Linked;
- Average Cost and Harga Beli Terakhir are automatic read-only fields;
- Jenis Barang is a separate user-defined classification with stable code and no invented seed values;
- Tipe Barang, Jenis Barang, Satuan, and Resep/BOM remain separate reusable masters;
- Recipe Linked is explicit and must point to an active same-store recipe whose output is the same product;
- unsafe base-unit changes are rejected after recipe/stock history exists;
- product cost fields cannot be assigned directly through Product Master writes;
- Product Kind and cost identity are snapshotted into relevant transaction facts;
- Beli Bahan selects products from the active store Product Master database and requires an explicit Qty per line;
- Pengeluaran Operasional stores explicit Qty, default `1`, as customer-behaviour metadata while its amount remains the total expense value;
- operational Qty alone never posts stock.

### Still intentionally open: canonical Accounting settings and synchronization

Migration 0018 currently provides a provisional `MAXI_ACCOUNTING_REFERENCE_V1` registry, mapping slots, and immutable transaction mapping snapshots. It does not own canonical Accounting journals.

The final Accounting Settings schema, canonical account identities, payment-method/account rules, item-category rules, warehouse registration rules, external synchronization, dispatcher behavior, journal references, and reconciliation remain separate work. The type/schema audit was completed and Bos Cyo approved the canonical direction: Leker follows MAXI canonical conventions, exact money/costing is required, and physical quantities will become fractional-capable under an explicit compatibility migration.

Prototype Leker must not write directly to the separate Accounting program database.

## Accounting integration seam prepared

Prototype Leker exposes `MAXI_ACCOUNTING_BUSINESS_FACT_V1` for business facts and `MAXI_ACCOUNTING_REFERENCE_V1` for provisional connector references. The separate Accounting program owns journal interpretation, canonical chart of accounts, buku besar, neraca saldo, neraca, laba rugi, and accounting closing.

Current cross-program sync state remains `NOT_CONNECTED`. This does not block operational transaction tracking or local immutable reference snapshots.

## Portal Staf V1

Live-photo attendance is active for authenticated cashier/employee sessions and is independent from drawer state. KPI, Riwayat Setoran, and Riwayat Gaji are intentionally exposed as isolated empty portal sections until their own versioned data contracts are implemented.

This is not a blocker for attendance or cashier operations.

## Staff session dan duplicate tab

Issue sebelumnya tentang duplicate cashier tab ditutup oleh kombinasi:

- canonical login dipisah menjadi Pelanggan dan Karyawan;
- satu staff account hanya mempunyai satu active server session;
- satu browser hanya mempunyai satu active staff tab melalui local browser lease;
- takeover session harus explicit;
- customer session tetap terpisah dan boleh coexist dengan satu staff tab.

Jika browser-tab lease atau takeover menghasilkan failure baru pada testing live, catat sebagai issue baru dengan langkah reproduksi dan jangan menghidupkan kembali periodic network polling sebagai workaround.

## DOC-IMPACT

**REQUIRED** — Product Master/costing behavior is governed by contracts v2 and ADR-015. Remaining fractional inventory quantity migration, Sale-level fulfillment migration, Stock Adjustment, KPI, Deposit, Payroll, canonical Accounting settings/sync, and journal-generation engine stay open until their own contracts are implemented.
