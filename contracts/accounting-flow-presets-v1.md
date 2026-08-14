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

The operational fact for cashier Arus Kas uses the configured active `CASH` settlement/payment method, so Kas is on Debit when physical cash increases.

### `cash_flow_out`

- Debit: `fixed_account` selected by the administrator
- Credit: `payment_method`

The operational fact uses the configured active `CASH` settlement/payment method, so Kas is on Credit when physical cash decreases.

Each direction can expose multiple counterpart choices referencing active Accounting accounts. The administrator adds choices and marks exactly one as the default through Setting Akuntansi. The cashier sees only those configured choices and the default is preselected, while remaining changeable before submission.

Initial canonical defaults are Pendapatan Lainnya for cash-in and Beban Lainnya for cash-out. They are stored in the same Setting Akuntansi registry and may be replaced by the administrator; they are not hardcoded form decisions.

The UI explicitly classifies the selected counterpart:

- ASSET / LIABILITY / EQUITY = balance-sheet / non-P&L pairing;
- REVENUE / EXPENSE = affects Profit & Loss by design.

This classification is informational. The administrator remains responsible for business meaning.

### Active Cash Flow consumer

Approved + posted `CASH_FLOW` facts are consumed by `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1` after the operational ACC has committed.

The bridge uses these exact preset categories/rules rather than creating a private mapping table. Missing/incomplete cash-flow configuration returns `NEEDS_CONFIGURATION` and can be retried idempotently without recreating the operational transaction.

## Goods Flow Direction

### `goods_flow_in`

- Debit: `item_category_inventory`
- Credit: configurable `fixed_account`

### `goods_flow_out`

- Debit: configurable `fixed_account`
- Credit: `item_category_inventory`

The Persediaan account therefore follows the existing Jenis Barang mapping. The administrator may pair inventory movement with a balance-sheet account so the movement does not automatically become profit/loss, or intentionally choose Revenue/Expense when the business event really represents gain/loss.

The preset does not invent valuation. A future Accounting bridge for generic GOODS_FLOW must consume an exact Inventory/Costing valuation snapshot; it must not value a quantity movement from current mutable master cost at posting time.

**The goods-flow presets remain configuration-only. No generic GOODS_FLOW Accounting delivery is active in V1.**

## Safe Re-Apply

A preset may create its canonical transaction category, settlement rule, and first counterpart when none exist.

For Cash Flow, re-applying adds a counterpart choice without overwriting existing choices. A selected choice may be promoted to default. For Goods Flow, the existing managed two-rule update behavior remains unchanged.

If the category has a customized active rule shape, the preset must refuse to overwrite it. The administrator edits that category manually in Aturan Transaksi.

## Warehouse Boundary

Warehouse choices are read from the existing `MAXI_WAREHOUSE_SETTINGS_V1` capability. Accounting Settings does not create a warehouse mapping table.

Current Prototype Leker canonical physical stock balance remains store-scoped in `inventory_stock_balances`; it is not yet warehouse-scoped. Therefore source/destination Warehouse execution for Arus Barang is explicitly HOLD.

The UI may display active Warehouses as references, but it must not claim a warehouse-specific stock movement occurred until Inventory/Warehouse owns a versioned warehouse-level stock location model.

Future warehouse transfer must reuse that Warehouse capability and provide source/destination facts to Accounting. Accounting may then interpret value reclassification without becoming the owner of physical stock.

## Posting Boundary

Cash Flow preset configuration is actively consumed only after an approved operational Cash Flow fact exists. Operational approval remains owned by the Approval Queue / cash domain; Accounting owns journal interpretation and posting after commit.

Goods Flow presets still configure intended journal shapes only. They do not activate a generic GOODS_FLOW bridge by themselves.

## Implementation

- `public/admin-accounting-flow-presets.js`
- `src/accounting-cash-flow-bridge.js`
- `contracts/accounting-cash-flow-bridge-v1.md`
- existing `/api/admin/settings/accounting/transaction-categories`
- existing `/api/admin/settings/accounting/journal-rules`
- existing `/api/admin/settings/warehouse`
- `test/accounting-flow-presets.test.js`
- `test/accounting-cash-flow-bridge.test.js`

## DOC-IMPACT

REQUIRED — changes to cash direction, goods direction, counterpart behavior, P&L classification, overwrite safety, warehouse routing status, or posting boundary require matching contract/ADR/tests.
