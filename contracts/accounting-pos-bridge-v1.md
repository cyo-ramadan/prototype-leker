# Accounting POS Bridge v1

Status: ACTIVE IN STACKED DRAFT / NOT DEPLOYED
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

## Resolution Rules

### Payment method

A `payment_method` rule resolves the transaction payment-method code through `payment_methods.account_id`.

If the method or account mapping is unavailable, the bridge returns `NEEDS_PAYMENT_METHOD` or `NEEDS_PAYMENT_MAPPING`.

### Sale revenue

`item_category_revenue` resolves each sale item through its snapshotted `productKindId` and `item_categories.revenue_account_id`.

Amounts use the exact sale line amount.

### Purchase inventory

`item_category_inventory` on a purchase resolves each purchase item through its `productKindId` and `inventory_account_id`.

Amounts use the exact purchase line amount.

### Operational expense component

Operational Debit components use active fixed-account Debit rules from the `operational` transaction category.

The POS fact may carry `accountingComponentRuleId`, which identifies the chosen **rule/component**, not an account. The bridge then resolves the account owned by Accounting Settings.

If exactly one applicable Debit fixed-account rule exists, v1 may resolve it without an explicit component selection. Multiple applicable components without a selected rule fail `NEEDS_COMPONENT_SELECTION`.

## Fail-Closed Status

Delivery status is one of:

- `POSTED`;
- `NEEDS_CONFIGURATION`;
- `FAILED`;
- `PENDING` where applicable.

Common configuration failures include:

- `NEEDS_MAPPING`;
- `NEEDS_TRANSACTION_MAPPING`;
- `NEEDS_PAYMENT_METHOD`;
- `NEEDS_PAYMENT_MAPPING`;
- `NEEDS_PRODUCT_KIND`;
- `NEEDS_ITEM_CATEGORY_MAPPING`;
- `NEEDS_COMPONENT_SELECTION`;
- `NEEDS_COST_ROUNDING_POLICY`.

Missing configuration never triggers a guessed account or fallback journal.

## HPP / COGS Precision Blocker

Sale HPP snapshots use exact scaled cost where `1 rupiah = 1,000,000 cost units`. Accounting journal lines currently use exact integer `amountMinor` at the journal currency unit convention.

No approved canonical rule currently defines how a non-integral scaled sale COGS value should convert into a journal amount.

Therefore, active sale rules using:

- `item_category_cogs`; or
- sale-side `item_category_inventory`

fail closed with `NEEDS_COST_ROUNDING_POLICY` until Bos Cyo / the canonical Accounting contract approves the conversion/rounding rule.

The bridge must not silently floor, ceil, truncate, or round these values.

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

The resolver supports any active configured payment-method code carried by a source fact, but current cashier screens still have legacy payment-method choices in parts of the POS UI.

Before arbitrary new payment methods are fully exposed in Cashier:

- Cash Drawer classification must treat only `CASH` as physical cash;
- all other payment-method codes must be non-cash;
- Sale/Purchase/Expense entry screens must load active payment methods from Settings;
- Operational entry must expose component selection when multiple Debit expense components exist.

These are integration/UI follow-ups, not permission to duplicate mappings inside POS.

## Implementation

- `migrations/0025_accounting_pos_bridge.sql`
- `src/accounting-pos-bridge.js`
- `src/accounting-pos-bridge-response.js`
- `public/admin-accounting-bridge-ui.js`
- `test/accounting-pos-bridge.test.js`

## DOC-IMPACT

REQUIRED — changes to supported fact types, mapping semantics, idempotency, status behavior, rounding policy, or post-commit safety require contract/ADR/test updates.
