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
- migrations `0016_manufacturing_master_v1.sql`, `0017_product_stock_production_points.sql`, and `0019_product_costing_and_kinds.sql`;
- `src/manufacturing-master.js` and `src/stock-production.js`.

Current behavior:

- physical stock and recipe quantities are integer values in each product's smallest selected base unit;
- `inventory_stock_balances` is the current quantity source and `stock_movements` is the auditable movement history;
- manual Produksi and the legacy AUTO_DADAKAN path use the same production engine;
- tracked stock may not become negative;
- inventory purchases are itemized and create PURCHASE stock-in movements;
- `products.average_cost` is the running HPP source;
- `products.last_purchase_price` updates automatically from the newest itemized purchase;
- purchase rows snapshot average cost before/after;
- production components snapshot average cost, production derives HPP total/unit, and output average cost is updated;
- sale items snapshot unit HPP and line COGS so history is not recomputed from current master values;
- Admin has dedicated Stok and lazy transaction-detail read models.

### Still intentionally open: Sale-level fulfillment migration

Mode Pemenuhan is no longer editable in Master Barang. The legacy `products.production_mode` column remains temporarily because existing sale execution still reads it.

A future Sale contract must move fulfillment ownership to the Penjualan transaction and define the requested default `DADAKAN`. Until that versioned migration is implemented, do not delete or reinterpret the legacy column and do not silently change existing sale behavior.

### Still intentionally open: Penyesuaian Stok write contract

The cashier Penyesuaian Stok entry point remains inactive until an explicit adjustment reason/audit/approval contract is defined. Future adjustment posting must reuse `stock_movements` and must not bypass the stock audit model.

## Product Master, Jenis Barang, and Accounting reference seam

Current behavior is governed by:

- `contracts/product-master-accounting-reference-v2.md`;
- ADR-015;
- migration `0019_product_costing_and_kinds.sql` plus the provisional Accounting reference objects from migration 0018.

Current behavior:

- Master Barang edits product identity, Tipe Barang, Jenis Barang, Satuan Dasar, points, stock tracking, and Recipe Linked;
- Average Cost and Harga Beli Terakhir are automatic read-only fields;
- Jenis Barang is a separate user-defined classification with stable code and no invented seed values;
- Tipe Barang, Jenis Barang, Satuan, and Resep/BOM remain separate reusable masters;
- Recipe Linked is explicit and must point to an active same-store recipe whose output is the same product;
- unsafe base-unit changes are rejected after recipe/stock history exists;
- product cost fields cannot be assigned directly through Product Master writes;
- Product Kind and cost identity are snapshotted into relevant transaction facts.

### Still intentionally open: canonical Accounting settings and synchronization

Migration 0018 currently provides a provisional `MAXI_ACCOUNTING_REFERENCE_V1` registry, mapping slots, and immutable transaction mapping snapshots. It does not own canonical Accounting journals.

The final Accounting Settings schema, canonical account identities, payment-method/account rules, item-category rules, warehouse registration rules, external synchronization, dispatcher behavior, journal references, and reconciliation remain separate work. Those changes require a fresh cross-module type/schema audit and explicit approval before final schema creation.

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

**REQUIRED** — current Product Master/costing behavior is governed by `contracts/product-master-accounting-reference-v2.md`, `contracts/stock-production-points-v2.md`, and ADR-015. Remaining inactive Stock Adjustment, Sale-level fulfillment migration, KPI, Deposit, Payroll, canonical Accounting settings/sync, and journal-generation engine stay open until their own contracts are approved.
