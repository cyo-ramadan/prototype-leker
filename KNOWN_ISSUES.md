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
- the user must correct stock through an approved Penyesuaian Stok flow until the balance is at least `0`, then retry the purchase;
- the purpose is to prevent a negative-stock anomaly from being silently absorbed into a new moving-average HPP baseline.

Ownership note: this policy belongs to Inventory/Costing even if surfaced from a shared Settings UI such as a `Policy Integritas HPP` section near Setting Akuntansi. Accounting must not become the owner of stock/HPP mutation rules.

**Dependency:** the Penyesuaian Stok write contract below is still inactive on `main`. Therefore this policy must default OFF and must not be enabled in production until the user has an approved adjustment path, otherwise a negative-stock item could become operationally deadlocked.

### Still intentionally open: Sale-level fulfillment migration

Mode Pemenuhan is no longer editable in Master Barang. The legacy `products.production_mode` column remains temporarily because existing sale execution still reads it.

A future Sale contract must move fulfillment ownership to the Penjualan transaction and define the requested default `DADAKAN`. Until that versioned migration is implemented, do not delete or reinterpret the legacy column and do not silently change existing sale behavior.

### Still intentionally open: Penyesuaian Stok write contract

The cashier Penyesuaian Stok entry point remains inactive on `main` until an explicit adjustment reason/audit/approval contract is merged. Future adjustment posting must reuse `stock_movements` and must not bypass the stock audit model.

This flow is now also a prerequisite for safely enabling the planned store-level `blockPurchaseWhenStockNegative` HPP integrity policy.

## Product Master, Jenis Barang, Purchase Qty, and Operational Qty

Current behavior is governed by:

- `contracts/product-master-accounting-reference-v2.md`;
- ADR-015;
- migrations `0019_product_costing_and_kinds.sql`, `0020_expense_quantity_behavior.sql`, and `0021_exact_production_costing.sql`.

Current behavior:

- Master Barang edits product identity, Tipe Barang, Jenis Barang, Satuan Dasar, points, stock tracking, and Recipe Linked;
- Average Cost and Harga Beli Terakhir are automatic read-only fields;
- Jenis Barang is a separate user-defined classification with stable code and no invented seed values;
- Recipe Linked is explicit and same-store/output validated;
- product cost fields cannot be assigned directly through Product Master writes;
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
- Warehouse Settings owns warehouse/location, staff access, and stock-opname parameters;
- Warehouse registers `wh_transfer`, `wh_opname`, `wh_production`, and `wh_return` into Accounting `transaction_categories`;
- Warehouse has no account-mapping table;
- adjustment accounts `4201 Pendapatan Koreksi Stok` and `6103 Beban Susut Persediaan` are marked `review_required=1`;
- `wh_return` remains deliberately without default rules until return direction/subtype is defined;
- old provisional pair-mapping writer is retired.

## Accounting Workspace and POS bridge — deployed live

Accounting Workspace, Setting Akuntansi, POS Accounting bridge, and six-decimal Accounting precision are deployed on the permanent Prototype Leker Worker. The remote dedicated D1 migration chain is applied through `0026_accounting_six_decimal_precision.sql`.

Current behavior is governed by:

- `contracts/accounting-workspace-v1.md`;
- `contracts/accounting-pos-bridge-v1.md`;
- ADR-018 and ADR-019;
- migrations `0024_accounting_workspace.sql`, `0025_accounting_pos_bridge.sql`, and `0026_accounting_six_decimal_precision.sql`;
- `src/accounting-ledger.js`;
- `src/accounting-workspace.js`;
- `src/accounting-pos-bridge.js`;
- `src/accounting-pos-bridge-response.js`.

### Resolved production deployment incident — historical D1 schema drift

On 2026-08-13 the remote D1 migration ledger reported migrations through `0022` as applied, but two compatibility objects originally defined by migration `0018_product_master_accounting_reference.sql` were absent from the live schema:

- `transaction_accounting_mappings`;
- `transaction_accounting_snapshots`.

That drift caused migration `0023_accounting_snapshot_settings_compat.sql` to fail before Accounting Workspace migrations could continue. The failure was diagnosed through the existing Cloudflare Workers Git Integration without exposing Cloudflare credentials.

Recovery performed under Bos Cyo's explicit deployment authority:

- captured a D1 Time Travel checkpoint before mutation;
- inspected live `sqlite_schema` and migration state;
- recreated only the exact missing compatibility objects from the authoritative `0018` definition using idempotent DDL/seed operations;
- resumed canonical remote migrations `0023` through `0026`;
- restored the repository-owned deploy command to `npm run db:migrations:apply && npx wrangler deploy`;
- removed temporary diagnostic/recovery scripts and public diagnostic assets;
- verified a subsequent normal Cloudflare Git build succeeds without the recovery path;
- verified live Accounting assets and protected API routes through the reusable smoke workflow in `cyo-ramadan/program-kasir`.

The incident is resolved. Do not rewrite or retroactively alter already-applied migration history to hide this drift; use schema inspection and an explicit recovery path if a similar mismatch appears again.

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
- manual sync is available from the Accounting workspace for older/unposted-to-Accounting POS facts;
- sale `item_category_cogs` and sale-side `item_category_inventory` use the snapshotted `sale_items.line_cogs` scaled value directly, so the former cost-rounding blocker is resolved by ADR-019;
- missing sale COGS snapshot fails closed with `NEEDS_COST_SNAPSHOT` rather than recomputing from current Product Master cost.

### Open: dynamic cashier payment-method integration

The Accounting resolver can resolve any active configured `payment_methods.code` carried by a POS fact, but cashier entry screens still contain legacy payment choices in parts of the current UI.

Before arbitrary Settings payment methods such as QRIS/EDC/aggregators are exposed in Cashier:

- sale/purchase/expense inputs must load active payment methods from Settings;
- drawer classification must treat only `CASH` as physical drawer cash and all other methods as non-cash;
- legacy `NON_CASH` remains an explicit compatibility payment component and intentionally has no default account mapping.

### Open: operational component selection UI

The bridge supports `expenses.accounting_component_rule_id` so Operasional can select one configured Debit expense component without POS carrying an account ID.

Current cashier UI does not yet expose that selector. If there is exactly one active operational Debit fixed-account rule, v1 may resolve it automatically. Multiple Debit components without a selected component fail `NEEDS_COMPONENT_SELECTION`.

### Open: Stock Opname rule branch semantics

The default `wh_opname` category contains labeled gain and loss rule rows. A future Warehouse-to-Accounting bridge must choose the correct branch from the actual signed adjustment and must never execute all four rows blindly. The two adjustment accounts require owner review before posting is enabled.

### Open: return taxonomy

`wh_return` is registered but fail-closed. Supplier return, customer return, and internal return can have different Accounting meaning, so no default rule is invented yet.

### Legacy business-fact seam

`MAXI_ACCOUNTING_BUSINESS_FACT_V1` is superseded for SALE/PURCHASE/EXPENSE by `MAXI_ACCOUNTING_POS_BRIDGE_V1`.

The old helper remains only for operational fact kinds that have not yet migrated to an active bridge. The shared `@maxi/accounting@1.3.0` service is still not deployed; the current Accounting implementation is a Prototype Leker composition host with an explicit future adapter boundary.

## Portal Staf V1

Live-photo attendance is active for authenticated cashier/employee sessions and is independent from drawer state. KPI, Riwayat Setoran, and Riwayat Gaji are intentionally exposed as isolated empty portal sections until their own versioned data contracts are implemented.

## Staff session dan duplicate tab

Canonical login remains separated into Pelanggan and Karyawan, one staff account has one active server session, and one browser has one active staff tab through the local browser lease. Customer sessions remain separate.

If browser-tab lease or takeover creates a new failure, record a new issue and do not restore tight periodic polling as a workaround.

## DOC-IMPACT

**REQUIRED** — Product Master/costing contracts, Accounting Settings/Warehouse Settings, Accounting Workspace/POS Bridge contracts, ADR-015 through ADR-019, migrations through 0026, deployment recovery evidence, and regression/live-smoke tests describe the active implementation state. Accounting Workspace and Setting Akuntansi are live. Remaining major work includes fractional inventory quantity migration, Sale fulfillment migration, Stock Adjustment execution, store-level HPP integrity policy for negative stock, dynamic cashier payment methods/components, Warehouse-to-Accounting posting semantics, return taxonomy, KPI, Deposit, and Payroll transaction implementations.
