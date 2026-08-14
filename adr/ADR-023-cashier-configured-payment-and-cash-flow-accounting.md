# ADR-023 — Cashier Configured Payment Inputs and Cash Flow Accounting

Status: ACTIVE / DEPLOYED LIVE
Date: 2026-08-14

## Context

Prototype Leker Accounting Settings already owns active `payment_methods`, transaction categories, journal rules, and account references. The POS Accounting resolver can consume arbitrary active payment-method codes, but cashier input surfaces still contained legacy fixed payment choices. The drawer report also treated only the literal legacy `NON_CASH` code as non-cash.

Separately, cashier `CASH_FLOW` requests already had an approved operational posting path and Accounting Settings already exposed `cash_flow_in` / `cash_flow_out` presets, but no active post-commit Accounting delivery connected those two capabilities.

Guessing Warehouse routing or goods-flow valuation remains unsafe because physical stock is still store-scoped and generic quantity movement has no authoritative exact value snapshot.

## Decision

### Cashier payment inputs

Cashier SALE, PURCHASE, and EXPENSE input surfaces read active payment methods from the canonical Accounting Settings registry.

The POS source fact carries only the selected payment-method code. POS does not carry the mapped Account ID or Debit/Credit decision.

Only payment code `CASH` is classified as physical drawer cash. Every other active payment code is non-cash for drawer reconciliation.

### Operational component selection

When multiple active Operational Debit fixed-account rules exist, the cashier selects a configured component by `journalRuleId`.

That rule ID is a component identity, not an Account ID. Accounting Settings remains the owner of the account behind the rule.

If exactly one component exists, it may be used automatically. Missing configuration continues to fail closed in the Accounting bridge.

### Approved Cash Flow

Operational Cash Flow approval remains owned by the Approval Queue / cash domain.

ACC first commits the operational cash movement. Only after that commit succeeds does `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1` resolve the approved fact into Accounting.

`IN` uses `cash_flow_in`; `OUT` uses `cash_flow_out`. V1 settles through the configured active `CASH` payment method and requires the preset's explicit fixed-account counterpart.

Accounting failure never rolls back the already-approved operational fact. Delivery state is recorded for reconciliation, and an idempotent management retry endpoint can replay the same approved fact.

### Held boundaries

No generic `GOODS_FLOW` Accounting bridge is activated by this decision.

Warehouse source/destination routing, exact goods-flow valuation, AUTO_DADAKAN sale correction meaning, and Return taxonomy remain HOLD until Bos Cyo decides their business semantics.

## Consequences

- New payment methods such as QRIS/EDC can flow through cashier inputs without adding new POS mapping tables.
- Cash Drawer expected cash cannot accidentally count arbitrary non-cash methods as physical cash.
- Operational expense component choice scales beyond one fixed Debit rule while preserving Accounting ownership.
- Approved Cash Flow becomes Accounting-reconcilable without coupling Accounting availability to the operational ACC transaction.
- Missing Accounting configuration remains visible instead of being silently guessed.
- Goods Flow remains intentionally incomplete rather than creating misleading warehouse/accounting evidence.

## Compatibility

Existing `CASH` and legacy `NON_CASH` facts remain valid. The change generalizes the input/reader behavior; it does not reinterpret historical rows.

No database migration is required for this decision because existing `payment_methods`, `expenses.accounting_component_rule_id`, `accounting_bridge_deliveries`, approval, and journal storage already support the required identities/state.

## Recovery

Application rollback can remove the configured-input UI and Cash Flow dispatcher code without destructive database rollback. Already-posted Accounting journals remain immutable and must follow normal reversal/correction policy if business correction is required.

Operational Cash Flow facts remain authoritative even if Accounting delivery is rolled back or temporarily disabled.

## Evidence

- `src/cashier-workspace.js`
- `public/cashier-workspace.js`
- `public/cashier-payment-methods.js`
- `src/cashier-sales-tracking.js`
- `src/cashier-purchase.js`
- `src/cashier-operational-expense.js`
- `src/drawer-report.js`
- `src/accounting-cash-flow-bridge.js`
- `src/approval-queue.js`
- `contracts/accounting-cash-flow-bridge-v1.md`
- `test/cashier-accounting-inputs.test.js`
- `test/accounting-cash-flow-bridge.test.js`

## DOC-IMPACT

REQUIRED — this ADR changes active Cashier/Accounting integration state and post-commit delivery behavior.
