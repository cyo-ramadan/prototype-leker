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

`CASH_FLOW` uses the separate `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1` because its source fact is created only after Approval Queue ACC/posting.

## Post-Commit Safety

Accounting delivery happens **after** the operational POS fact is committed.

If Accounting mapping is missing or Accounting delivery fails:

- the POS fact remains committed;
- the cashier response remains a successful operational transaction response;
- Accounting status is attached separately;
- retry uses the same source fact and idempotent Accounting command;
- the client must not create a second sale/purchase/expense merely because Accounting delivery failed.

## Mapping Ownership

The bridge reads the canonical operational registries plus Accounting configuration:

- POS-owned `payment_methods` identity/status and its nullable Accounting mapping;
- `item_categories`;
- `transaction_categories`;
- `journal_rules`;
- Accounting-owned account references in `chart_of_accounts`.

`accounting_bridge_deliveries` is delivery/reconciliation state only. It is not an account-mapping table.

Business-application tables must not foreign-key Accounting interpretation objects such as `journal_rules`, `chart_of_accounts`, `accounting_account_refs`, or `transaction_accounting_mappings`. Business modules report facts; the Bridge reads the Accounting registry and resolves journal interpretation after the fact is committed.

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

A `payment_method` rule resolves the POS-owned transaction payment-method code through the current compatibility mapping `payment_methods.account_id`.

If the method or account mapping is unavailable, the bridge returns `NEEDS_PAYMENT_METHOD` or `NEEDS_PAYMENT_MAPPING`.

Cashier SALE/PURCHASE/EXPENSE inputs consume the active `payment_methods` registry through `src/pos-payment-methods.js`, independently of this Accounting bridge. They may commit with an active method whose `account_id` is `NULL`; the operational fact succeeds and the post-commit bridge returns `NEEDS_PAYMENT_MAPPING`. Only code `CASH` represents physical drawer cash; every other active code is classified as non-cash by the drawer read model.

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

The cashier may select only active Master Barang products that are purchasable and stock-tracked. Each Jenis Barang receives an editable initial mapping to `Persediaan Bahan`; administrators may map finished or semi-finished kinds to another active inventory account through Setting Akuntansi.

The purchase journal shape is Debit `item_category_inventory` and Credit `payment_method`. Payment identity/default come from POS Core; its Accounting account mapping is resolved only by this bridge. Exactly one active payment method is the store default when the cashier has not selected one; the initial default is `CASH`. `PAYABLE` credits Utang Usaha when that mapping exists. `RECEIVABLE_OFFSET` is seeded inactive and is valid only for an intentional supplier-receivable offset after administrator review.

### Operational expense

Operasional reports the committed business fact with `business_event = EXPENSE`, transaction category `operational`, amount, and payment method. Operasional and Cost Master do not select or own a `journal_rules` row.

The Bridge resolves active rules for the `operational` transaction category from Setting Akuntansi. If exactly one applicable fixed Debit rule exists, it is deterministic Accounting configuration and may be resolved automatically by the Bridge. If multiple applicable fixed Debit rules make the Accounting configuration ambiguous, delivery fails closed as configuration incomplete. Operasional must not choose a rule to break that ambiguity.

Legacy `expenses.accounting_component_rule_id` values may still be read for historical retry/recovery compatibility, but new Operasional writes leave the compatibility field `NULL` and no Operasional API exposes it as current authority.

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
- `NEEDS_COMPONENT_SELECTION` (legacy status code for ambiguous Operational fixed-rule configuration);
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

## Cashier Input Integration

Active in this feature branch:

- SALE loads active payment methods from Setting Akuntansi;
- PURCHASE loads active payment methods from the same registry;
- EXPENSE loads active payment methods from the same registry;
- Cash Drawer classification treats only `CASH` as physical cash and every other method as non-cash;
- Operational entry selects a Cost Master / Jenis Biaya business concept; it never receives or submits `journalRuleId`;
- POS does not receive the Account ID or Accounting rule identity behind journal resolution.

Legacy `NON_CASH` remains a compatibility payment code when active/configured; it no longer has special hardcoded classification beyond being a non-`CASH` code.

A separate store-level Inventory/Costing policy is planned for transaction integrity such as blocking cost-affecting purchases while stock is negative. That policy is not owned by Accounting even if surfaced from a shared Settings UI.

## Implementation

- `migrations/0025_accounting_pos_bridge.sql`
- `migrations/0026_accounting_six_decimal_precision.sql`
- `migrations/0038_operational_accounting_boundary.sql`
- `src/accounting-pos-bridge.js`
- `src/accounting-pos-bridge-response.js`
- `src/cashier-operational-expense.js`
- `src/cashier-workspace.js`
- `src/cost-master.js`
- `public/cashier-payment-methods.js`
- `public/admin-cost-master.js`
- `public/admin-accounting-bridge-ui.js`
- `test/accounting-pos-bridge.test.js`
- `test/cashier-accounting-inputs.test.js`
- `test/operational-accounting-boundary.test.js`

## DOC-IMPACT

REQUIRED — changes to supported fact types, mapping semantics, idempotency, status behavior, precision/adjustment policy, cashier input registry behavior, or post-commit safety require contract/ADR/test updates. This change specifically changes how Operasional reports transactions to Accounting and removes a direct cross-module schema reference.
