# Accounting POS Bridge v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_ACCOUNTING_POS_BRIDGE_V1`

## Purpose

Connect committed Prototype Leker POS business facts to Accounting without moving Accounting ownership into POS.

Flow:

`POS fact -> Integration Bridge resolver -> Setting Akuntansi configuration -> Accounting postJournal -> Accounting journal store`

POS never writes Accounting journal tables directly.

## Supported Facts

V1 resolves:

- `SALE` -> transaction category `sale`;
- `PURCHASE` -> transaction category `purchase_material`;
- `EXPENSE` -> transaction category `operational`.

The bridge reads committed source facts after POS persistence succeeds.

## Post-Commit Safety

Accounting delivery happens **after** the operational POS fact is committed.

If Accounting mapping is missing or Accounting delivery fails:

- the POS fact remains committed;
- the cashier response remains a successful operational transaction response;
- Accounting status is attached separately;
- retry uses the same source fact and idempotent Accounting command;
- the client must not create a second sale/purchase/expense merely because Accounting delivery failed.

## Mapping Ownership

The bridge reads only the canonical Settings registry:

- `payment_methods`;
- `item_categories`;
- `transaction_categories`;
- `journal_rules`;
- Accounting-owned account references in `chart_of_accounts`.

`accounting_bridge_deliveries` is delivery/reconciliation state only. It is not an account-mapping table.

## Amount Precision

Accounting journal amounts use the same exact scale as current authoritative HPP snapshots:

- `1 rupiah = 1,000,000 scaled units`;
- maximum 6 decimal places;
- values beyond the sixth decimal are rounded half-up at the seventh digit by the Accounting posting boundary;
- no binary `REAL/FLOAT` source of truth.

Whole-rupiah POS amounts such as sale revenue, purchase amount, and operational expense are converted exactly by multiplying by `1,000,000`.

Sale HPP snapshots already use this scale, so HPP can now flow to Accounting without an intermediate whole-rupiah conversion.

## Resolution Rules

### Payment method

A `payment_method` rule resolves the transaction payment-method code through `payment_methods.account_id`.

If the method or account mapping is unavailable, the bridge returns `NEEDS_PAYMENT_METHOD` or `NEEDS_PAYMENT_MAPPING`.

### Sale revenue

`item_category_revenue` resolves each sale item through its snapshotted `productKindId` and `item_categories.revenue_account_id`.

Amounts use the exact sale line amount converted from whole rupiah to the Accounting scale.

### Sale HPP / inventory

For `SALE`:

- `item_category_cogs` uses the item's snapshotted `lineCogsScaled` as Debit HPP;
- sale-side `item_category_inventory` uses the same `lineCogsScaled` as Credit Persediaan;
- the bridge does not recompute historical HPP from current Product Master cost;
- missing HPP snapshot fails `NEEDS_COST_SNAPSHOT`;
- invalid scaled HPP fails `BUSINESS_FACT_COST_INVALID`.

The former whole-rupiah HPP conversion blocker is resolved by the approved six-decimal Accounting precision contract.

### Purchase inventory

`item_category_inventory` on a purchase resolves each purchase item through its `productKindId` and `inventory_account_id`.

Amounts use the exact purchase line amount converted from whole rupiah to Accounting scale.

### Operational expense component

Operational Debit components use active fixed-account Debit rules from the `operational` transaction category.

The POS fact may carry `accountingComponentRuleId`, which identifies the chosen **rule/component**, not an account. The bridge then resolves the account owned by Accounting Settings.

If exactly one applicable Debit fixed-account rule exists, v1 may resolve it without an explicit component selection. Multiple applicable components without a selected rule fail `NEEDS_COMPONENT_SELECTION`.

## System Adjustment Tolerance

Bridge-generated journals explicitly request the approved Accounting system-adjustment policy `AUTO_EQUITY_UP_TO_100_RUPIAH`.

After all rule lines resolve:

- exact balance -> post normally;
- imbalance `<= Rp100.000000` -> Accounting adds one system-generated `Penyesuaian` line to the dedicated Equity account;
- imbalance `> Rp100.000000` -> posting fails closed;
- manual journals are outside this tolerance policy.

The bridge itself does not choose a Modal account or write an adjustment line directly; Accounting owns that interpretation.

## Fail-Closed Status

Delivery status is one of:

- `POSTED`;
- `NEEDS_CONFIGURATION`;
- `FAILED`;
- `PENDING` where applicable.

Common configuration/integrity failures include:

- `NEEDS_MAPPING`;
- `NEEDS_TRANSACTION_MAPPING`;
- `NEEDS_PAYMENT_METHOD`;
- `NEEDS_PAYMENT_MAPPING`;
- `NEEDS_PRODUCT_KIND`;
- `NEEDS_ITEM_CATEGORY_MAPPING`;
- `NEEDS_COMPONENT_SELECTION`;
- `NEEDS_COST_SNAPSHOT`;
- `BUSINESS_FACT_COST_INVALID`;
- `UNBALANCED_JOURNAL_OUTSIDE_TOLERANCE`.

Missing configuration never triggers a guessed account or fallback journal.

## Idempotency

Accounting command idempotency key:

`LEKER_POS:<FACT_TYPE>:<FACT_ID>`

A repeated bridge dispatch for an already-posted fact returns the existing journal reference instead of creating another journal.

## Delivery State

`accounting_bridge_deliveries` records:

- producer module;
- source fact type/id;
- transaction category code;
- status;
- journal reference when posted;
- failure code/detail;
- attempt count/timestamps.

It must not contain debit/credit account mappings.

## Current Input Limitations

The resolver supports any active configured payment-method code carried by a POS fact, but current cashier screens still have legacy payment-method choices in parts of the POS UI.

Before arbitrary new payment methods are fully exposed in Cashier:

- Cash Drawer classification must treat only `CASH` as physical cash;
- all other payment-method codes must be non-cash;
- Sale/Purchase/Expense entry screens must load active payment methods from Settings;
- Operational entry must expose component selection when multiple Debit expense components exist.

These are integration/UI follow-ups, not permission to duplicate mappings inside POS.

A separate store-level Inventory/Costing policy is planned for transaction integrity such as blocking cost-affecting purchases while stock is negative. That policy is not owned by Accounting even if surfaced from a shared Settings UI.

## Implementation

- `migrations/0025_accounting_pos_bridge.sql`
- `migrations/0026_accounting_six_decimal_precision.sql`
- `src/accounting-pos-bridge.js`
- `src/accounting-pos-bridge-response.js`
- `public/admin-accounting-bridge-ui.js`
- `test/accounting-pos-bridge.test.js`

## DOC-IMPACT

REQUIRED — changes to supported fact types, mapping semantics, idempotency, status behavior, precision/adjustment policy, or post-commit safety require contract/ADR/test updates.
