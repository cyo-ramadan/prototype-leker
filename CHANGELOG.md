# Changelog — Prototype Leker

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
