# Changelog — Prototype Leker

## 2026-08-17 — Operasional Accounting boundary

Change ID: `LEKER-OPS-ACC-BOUNDARY-20260817`

- Remove direct foreign-key ownership from `expenses.accounting_component_rule_id` to Accounting-owned `journal_rules`.
- Remove the same upstream cross-module foreign key from `cost_types.accounting_component_rule_id` so Cost Master is no longer an Accounting-rule proxy.
- Preserve all non-null legacy selector values in `operational_accounting_boundary_recovery_0038` and keep the compatibility TEXT columns for governed rollback/retry evidence.
- New Operasional writes report `EXPENSE` / `operational` business facts, amount, quantity metadata, Cost Master context, and payment method without choosing a journal rule.
- Keep the existing shared post-commit POS Accounting Bridge lane used by SALE and PURCHASE; no parallel outbox or new resolver is introduced.
- Remove Accounting rule components from cashier workspace payloads and Cost Master UI/API; account/rule mapping remains in Setting Akuntansi.
- Add migrated-SQLite expense creation, shared-Bridge contract, and direct-FK regression tests.
- Add ADR-029 and update the active Accounting POS Bridge contract and Known Pitfalls.

### Recovery

Primary rollback is D1 Time Travel to the checkpoint captured before migration `0038`. Secondary audit/recovery evidence is stored in `operational_accounting_boundary_recovery_0038`; the deprecated compatibility columns remain available but must not be treated as current mapping authority. Reattaching the historical FK semantics requires a governed recovery migration, not an ad-hoc application change.

### DOC-IMPACT

**REQUIRED** — changes how Operasional reports transactions to Accounting; removes a direct cross-module schema reference.

## 2026-08-17 — Accounting schema reconciliation

Change ID: `LEKER-ACC-SCHEMA-RECON-20260817`

- Reconcile four out-of-band orphan Accounting tables from the live D1 schema: `accounting_accounts`, `accounting_dimensions`, `accounting_opening_balances`, and `accounting_transaction_mappings`.
- Preserve all pre-drop rows in timestamped recovery-only snapshot tables before removing the stale runtime tables.
- Record captured row counts and `chart_of_accounts` canonical ownership in `accounting_schema_reconciliation_log`.
- Add a fail-closed migration dependency guard so unexpected live schema references stop the cleanup before any drop.
- Extend the remote D1 schema verifier to reject the four orphan table names and reject a second five-type Chart-of-Accounts definition.
- Add repository-wide orphan-reference audit evidence and schema-introspection regression coverage.
- Trace the stale schema definition to unmerged PR #3 commit `65b3faa0b130f9ecbbf21b9a592f9dcf376f8cec`, migration `migrations/0012_pos_integration_foundation.sql`. Current `main` never contained that migration.
- No new transaction registration, Accounting mapping, public API, or journal semantics are introduced.

### Recovery

Primary production rollback is D1 Time Travel to the checkpoint captured immediately before repository migrations execute. Timestamped reconciliation snapshot tables remain available as secondary row-level recovery evidence. A rollback must not silently reactivate the stale Accounting architecture; restoration of the orphan schema requires an explicit governed recovery decision.

### DOC-IMPACT

**REQUIRED** — database schema change affecting accounting domain.