# Accounting Schema Reconciliation Audit — 2026-08-17

Change ID: `LEKER-ACC-SCHEMA-RECON-20260817`

Protocol classification: `TRANSACTION_POTENTIAL: YES`

## Scope

Audit the current `main` source tree before removing four out-of-band Accounting schema objects from the Prototype Leker D1 database:

- `accounting_accounts`
- `accounting_dimensions`
- `accounting_opening_balances`
- `accounting_transaction_mappings`

The similarly named canonical compatibility table `transaction_accounting_mappings` is outside this cleanup scope.

## Current-main reference audit

Baseline commit: `c909c6b2b1cfbb6af9b076e9cf828c26c0e761bc`.

A recursive repository audit was executed in CI over application source, public assets, scripts, migrations, tests, and documentation before the reconciliation migration/documentation existed. Exact output:

```text
ACCOUNTING_ORPHAN_SCHEMA_AUDIT=[]
```

Classification result for current `main` before reconciliation:

| Table | File/line references | Classification |
|---|---|---|
| `accounting_accounts` | none | no active code path |
| `accounting_dimensions` | none | no active code path |
| `accounting_opening_balances` | none | no active code path |
| `accounting_transaction_mappings` | none | no active code path |

The same CI run completed `npm run check` and the full `npm test` suite with 220 passing tests and 0 failures. Decision Gate 2a therefore applies: schema reconciliation may proceed.

## Migration lineage and PR provenance

The current `main` migration directory does not contain a migration that creates the four orphan tables. Current `0012` is `0012_drawer_bound_sales_orders.sql`.

The four orphan table definitions were found in unmerged PR #3, commit:

- PR: `#3` — `feat: make Leker POS multi-store integration-ready`
- commit: `65b3faa0b130f9ecbbf21b9a592f9dcf376f8cec`
- stale migration: `migrations/0012_pos_integration_foundation.sql`
- table-definition lines in that stale commit:
  - line 31: `accounting_accounts`
  - line 49: `accounting_dimensions`
  - line 62: `accounting_opening_balances`
  - line 76: `accounting_transaction_mappings`

PR #3 remained unmerged. Its stale runtime file `src/integration-settings.js` also referenced these tables, but that file does not exist on current `main`. Relative to the active program it is **dead/unmerged branch code**, not an active code path. Representative stale-branch references include:

- lines 25–30: bootstrap reads from all four orphan tables;
- lines 68, 73, 95, 108, 114, 124, 156: `accounting_accounts` reads/writes;
- line 85: `accounting_dimensions` write;
- line 100: `accounting_opening_balances` write;
- lines 112 and 128: `accounting_transaction_mappings` read/write.

The live schema fingerprint matching this unmerged migration while current `main` has no creating migration means the orphan objects entered the live D1 outside the canonical main migration flow. The exact external command/operator that applied the stale schema is not established by repository history.

## Canonical Accounting registry

`chart_of_accounts` remains the sole canonical account-definition table for the Prototype Leker Accounting composition host. `accounting_journal_lines.account_id` continues to reference `chart_of_accounts`.

Canonical configuration/readiness structures that remain untouched include `journal_rules`, `accounting_account_refs`, `transaction_accounting_mappings`, `transaction_accounting_snapshots`, and `product_accounting_refs` according to their active compatibility/ownership contracts.

## Reconciliation safety

Migration `0037_accounting_schema_reconciliation.sql`:

1. fails closed if another schema object outside the approved four-table cleanup scope still depends on the orphan namespace;
2. snapshots every orphan row into timestamped recovery-only tables before any drop;
3. records source row counts and `chart_of_accounts` as canonical in `accounting_schema_reconciliation_log`;
4. drops child/reference orphan tables before `accounting_accounts`;
5. leaves the timestamped snapshots as inert recovery evidence, not runtime account registries.

The remote schema verifier additionally rejects the four exact orphan names and rejects a second table that defines all five Accounting account types (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`).

## Transaction registration impact

No new business transaction type, fact, journal mapping, or account mapping is introduced. Registration delta under MAXI Mandatory Transaction Registration Protocol v0.1 is **NONE**. This change reconciles schema ownership only.

## DOC-IMPACT

**REQUIRED** — database schema change affecting accounting domain.
