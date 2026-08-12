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

V1 intentionally does not define accounting journal/account mapping, inventory costing/valuation, lot/expiry, or individual asset depreciation.

## Manufacturing master and production posting — resolved operationally

Manufacturing Master is defined by:

- `contracts/manufacturing-master-v1.md`;
- ADR-012 and ADR-013;
- migration `0016_manufacturing_master_v1.sql`;
- `src/manufacturing-master.js`.

Stock, production, DADAKAN fulfillment, and product points are defined by:

- `contracts/stock-production-points-v1.md`;
- ADR-013;
- migration `0017_product_stock_production_points.sql`;
- `src/stock-production.js`.

Current behavior:

- physical stock and recipe quantities are integer values in each product's smallest chosen base unit;
- manual Produksi and AUTO_DADAKAN use the same production engine;
- production snapshots recipe id/revision, integer input/output quantities, actor, and source sale when applicable;
- DADAKAN production + stock movement + sale + customer points run inside one atomic D1 batch;
- tracked stock may not become negative;
- Admin has a dedicated Stok read panel and lazy movement history;
- Admin transaction detail exposes recipe/production snapshots without mutating master data.

### Still intentionally open: HPP / Inventory Costing

Production tables reserve decimal-capable HPP and component cost snapshot fields, but the costing method is not implemented yet.

FIFO, moving average, standard cost, landed cost, waste/yield valuation, and inventory-account journal mapping require a versioned Inventory/Costing contract. Recipe quantities alone are not a valid HPP value.

### Still intentionally open: Penyesuaian Stok write contract

The cashier Penyesuaian Stok entry point remains inactive until an explicit adjustment reason/audit/approval contract is defined. Future adjustment posting must reuse `stock_movements` and must not bypass the stock audit model.

## Product Master consolidation and Accounting reference bridge

Product configuration is now governed by `contracts/product-master-accounting-reference-v1.md` and ADR-014.

Current behavior:

- Master Barang is the visible editor for product core fields, Tipe Barang, Satuan Dasar, points, stock policy, STOCK/DADAKAN mode, Recipe Linked, and optional Accounting references;
- Tipe Barang, Satuan, and Resep/BOM remain separate reusable masters;
- the duplicate Klasifikasi Barang panel in the technical master is hidden but retained in DOM for compatibility;
- Recipe Linked is explicit and must point to an active recipe whose output is the same product;
- unsafe base-unit changes are rejected after recipe/stock history exists;
- Admin exposes basic provisional Accounting references and product reference fields;
- no product or transaction account mapping is assigned automatically.

### Still intentionally open: canonical Accounting synchronization and transaction mapping

`MAXI_ACCOUNTING_REFERENCE_V1` is only a provisional connector registry. The separate Accounting module remains the canonical owner of account identities and journal interpretation.

External account synchronization, transaction-level mapping, dispatcher behavior, journal references, and reconciliation will be introduced by a later bridge contract. Prototype Leker must not write directly to the Accounting program database.

## Accounting integration seam prepared

Prototype Leker exposes `MAXI_ACCOUNTING_BUSINESS_FACT_V1` for business facts and `MAXI_ACCOUNTING_REFERENCE_V1` for provisional account references. The separate Accounting program owns journals, canonical account mapping, buku besar, neraca saldo, neraca, laba rugi, and accounting closing.

Current business-fact sync state remains `NOT_CONNECTED`. This is expected while the Accounting/Integration Bridge implementation is being developed and is not a blocker for operational transaction tracking or manual preparation of reference mappings.

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

**REQUIRED** — approval posting is implemented under Operational Posting Contract v1; Live Photo / Staff Portal attendance is implemented under `contracts/live-photo-staff-portal-v1.md`; Manufacturing Master is governed by ADR-012/ADR-013; Stock, Production, DADAKAN fulfillment, and Product Points are governed by `contracts/stock-production-points-v1.md`; Product Master consolidation and provisional Accounting references are governed by `contracts/product-master-accounting-reference-v1.md` and ADR-014. Remaining inactive Stock Adjustment, KPI, Deposit, Payroll, HPP/Costing, canonical Accounting sync, and transaction account mapping stay visible until their own contracts are introduced.
