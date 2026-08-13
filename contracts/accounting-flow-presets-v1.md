# Accounting Flow Presets Contract v1

Status: ACTIVE for Prototype Leker UI configuration
Contract identifier: `MAXI_ACCOUNTING_FLOW_PRESETS_V1`
Owner: Accounting Settings configuration layer

## Purpose

Provide transaction-centric shortcuts for configuring common Arus Kas and Arus Barang Debit/Credit shapes without introducing a second mapping engine.

The presets write only through the existing canonical Setting Akuntansi registries:

1. `transaction_categories`
2. `journal_rules`
3. existing `chart_of_accounts` references
4. existing `payment_methods`
5. existing `item_categories`

No new accounting mapping table is created.

## Cash Flow Direction

### `cash_flow_in`

- Debit: `payment_method`
- Credit: `fixed_account` selected by the administrator

The intended operational fact for cashier Arus Kas uses the configured CASH settlement/payment method, so Kas is on Debit when cash increases.

### `cash_flow_out`

- Debit: `fixed_account` selected by the administrator
- Credit: `payment_method`

The intended operational fact uses CASH settlement/payment method, so Kas is on Credit when cash decreases.

The counterpart can reference any active Accounting account. The UI explicitly classifies the selected counterpart:

- ASSET / LIABILITY / EQUITY = balance-sheet / non-P&L pairing;
- REVENUE / EXPENSE = affects Profit & Loss by design.

This classification is informational. The administrator remains responsible for business meaning.

## Goods Flow Direction

### `goods_flow_in`

- Debit: `item_category_inventory`
- Credit: configurable `fixed_account`

### `goods_flow_out`

- Debit: configurable `fixed_account`
- Credit: `item_category_inventory`

The Persediaan account therefore follows the existing Jenis Barang mapping. The administrator may pair inventory movement with a balance-sheet account so the movement does not automatically become profit/loss, or intentionally choose Revenue/Expense when the business event really represents gain/loss.

The preset does not invent valuation. A future Accounting bridge for generic GOODS_FLOW must consume an exact Inventory/Costing valuation snapshot; it must not value a quantity movement from current mutable master cost at posting time.

## Safe Re-Apply

A preset may create its canonical transaction category and two rules when none exist.

If the category already contains the managed two-rule shape, re-applying updates only the configurable fixed-account counterpart and canonical labels/source directions.

If the category has a customized active rule shape, the preset must refuse to overwrite it. The administrator edits that category manually in Aturan Transaksi.

## Warehouse Boundary

Warehouse choices are read from the existing `MAXI_WAREHOUSE_SETTINGS_V1` capability. Accounting Settings does not create a warehouse mapping table.

Current Prototype Leker canonical physical stock balance remains store-scoped in `inventory_stock_balances`; it is not yet warehouse-scoped. Therefore source/destination Warehouse execution for Arus Barang is explicitly HOLD.

The UI may display active Warehouses as references, but it must not claim a warehouse-specific stock movement occurred until Inventory/Warehouse owns a versioned warehouse-level stock location model.

Future warehouse transfer must reuse that Warehouse capability and provide source/destination facts to Accounting. Accounting may then interpret value reclassification without becoming the owner of physical stock.

## Posting Boundary

This contract configures journal shapes only. It does not activate an Accounting bridge for CASH_FLOW or generic GOODS_FLOW by itself.

Operational approval remains owned by the existing Approval Queue / Inventory or Cash domain. Accounting owns journal interpretation and posting after an approved business fact carries sufficient exact context.

## Implementation

- `public/admin-accounting-flow-presets.js`
- existing `/api/admin/settings/accounting/transaction-categories`
- existing `/api/admin/settings/accounting/journal-rules`
- existing `/api/admin/settings/warehouse`
- `test/accounting-flow-presets.test.js`

## DOC-IMPACT

REQUIRED — changes to cash direction, goods direction, counterpart behavior, P&L classification, overwrite safety, warehouse routing status, or posting boundary require matching contract/ADR/tests.
