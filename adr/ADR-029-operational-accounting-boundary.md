# ADR-029 — Operasional reports facts; Accounting resolves journals

Status: ACCEPTED
Date: 2026-08-17
Change ID: `LEKER-OPS-ACC-BOUNDARY-20260817`

## Context

Prototype Leker Operasional historically stored `expenses.accounting_component_rule_id` with a foreign key to Accounting-owned `journal_rules`. Cost Master repeated the same dependency through `cost_types.accounting_component_rule_id`.

Audit confirmed that Operasional did **not** write Accounting journals directly. The direct rule id was consumed by `src/accounting-pos-bridge.js`, which then resolved accounts and called the Accounting posting entry point. The posting boundary therefore remained inside the Bridge, but the operational schema still carried Accounting interpretation state and crossed the module boundary.

Current `main` does not use an `integration_outbox` table for SALE, PURCHASE, or EXPENSE. These facts share the current canonical post-commit lane in `src/index.js`:

`committed POS fact -> attachAccountingBridgeToCommittedResponse -> Accounting POS Bridge -> Setting Akuntansi resolver -> Accounting posting entry point`

Reintroducing the stale outbox implementation from old overlapping work would create a second integration architecture and is outside this change.

## Decision

1. New Operasional writes report only business facts: expense detail/category context, amount, quantity metadata, payment method, and business event `EXPENSE` / transaction category `operational`.
2. Operasional and Cost Master do not select, validate, expose, or foreign-key a `journal_rules` row.
3. `expenses.accounting_component_rule_id` and `cost_types.accounting_component_rule_id` remain nullable TEXT only as historical rollback evidence. New runtime writes leave them `NULL` and runtime APIs do not expose them as authority.
4. Migration `0038_operational_accounting_boundary.sql` snapshots non-null legacy rule ids before rebuilding both schemas without Accounting-domain foreign keys.
5. The existing Accounting POS Bridge remains the sole journal-resolution lane for POS facts. It resolves `EXPENSE` against Setting Akuntansi exactly as it resolves the other supported POS facts.
6. If the `operational` transaction category has ambiguous fixed Debit rules and no deterministic Accounting-owned resolution is possible, the Bridge fails closed as configuration incomplete. Operasional must not break the tie by choosing an Accounting rule.
7. No change is made to `journal_rules`, `transaction_accounting_mappings`, `transaction_accounting_snapshots`, Chart of Accounts, or Accounting journal schema design.

## Consequences

- Operasional schema no longer has a direct FK to Accounting-owned tables.
- Cost Master stays a business master, not an Accounting configuration proxy.
- Cashier UI still uses Setting Akuntansi for payment-method availability but does not receive journal-rule identities.
- Historical expense rows keep their legacy selector value for compatibility/audit, while new rows are rule-agnostic.
- Existing post-commit idempotency, reconciliation state, and Accounting journal ownership remain unchanged.

## Rollback

Primary production rollback uses the D1 Time Travel checkpoint captured before migration application.

Migration `0038` also creates `operational_accounting_boundary_recovery_0038`, containing every non-null legacy selector from `expenses` and `cost_types`. The compatibility TEXT columns are preserved as well. A governed forward-recovery migration can therefore reattach the historical FK semantics if an approved rollback requires it; do not recreate the cross-module dependency ad hoc.

## Verification

- full migration chain applies on fresh SQLite;
- `PRAGMA foreign_key_list(expenses)` and `PRAGMA foreign_key_list(cost_types)` contain no Accounting-domain targets;
- expense handler creation test proves new rows keep `accounting_component_rule_id = NULL` and write `EXPENSE / operational` snapshot evidence;
- contract regression proves PURCHASE and EXPENSE share the same current post-commit Accounting Bridge lane;
- source regression rejects Operasional runtime references to `journal_rules` / `accountingComponentRuleId`.

## DOC-IMPACT

**REQUIRED** — changes how Operasional reports transactions to Accounting; removes a direct cross-module schema reference.
