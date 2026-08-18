# Changelog — Prototype Leker

## 2026-08-18 — Stock Adjustment PILATU composer

Change ID: `LEKER-STOCK-ADJUSTMENT-PILATU-20260818`

- Replace the cashier Penyesuaian Stok single-product selector with the reusable PILATU interaction: search, click a product, and immediately materialize its working row.
- Keep every prior selection in the working list; each later product is prepended above earlier rows. Selecting an existing product surfaces its existing row without deleting its entered physical quantity.
- Render five business columns: `Barang | Qty Tercatat | Qty Sebenarnya | HPP | Selisih`; only `Qty Sebenarnya` is editable.
- Keep Qty Tercatat as read-only Warehouse snapshot presentation and keep the HPP reference read-only/unavailable rather than fabricating a value while an approved read binding is absent.
- Submit each non-zero-difference row as its own existing `MAXI_STOCK_ADJUSTMENT_V1` Approval Queue request, preserving per-product server snapshot and stale guard semantics.
- Add executable regression coverage for the exact `Mineral -> Margarin` sequence so the first row cannot disappear when the second item is selected.
- No database migration and no change to stock posting, stale-snapshot, or approval semantics.

### Recovery

UI-only rollback is branch/commit revert. Existing pending approvals and posted stock movements are untouched because the backend contract remains unchanged.

### DOC-IMPACT

**REQUIRED** — cashier composition and reusable PILATU behavior changed; Stock Adjustment V1 contract and tests are synchronized.

## 2026-08-18 — Flexible Production Panel V2

Change ID: `LEKER-PRODUCTION-PANEL-V2-20260818`

- Replace the cashier's recipe-locked manual-production interaction with an editable Production Panel V2: output product + actual qty, Recipe/BOM template selector, and dynamic actual material rows that can be edited, added, or removed.
- Keep Recipe/BOM immutable. Selecting a recipe copies its ACTIVE revision into the transaction form; production edits never update `manufacturing_recipes` or `manufacturing_recipe_components`.
- Add Warehouse-owned flexible production execution that snapshots actual component quantities and exact scaled costs, posts `PRODUCTION_INPUT` / `PRODUCTION_OUTPUT` stock movements, recalculates exact production HPP, and updates output moving-average cost.
- Add migration `0039_flexible_manual_production.sql` to snapshot output/component Product Kind and whether the recipe template was modified, preserving deterministic Accounting interpretation after Master changes.
- Add a Warehouse -> Accounting production bridge using the existing `wh_production` Accounting Settings category and Accounting journal poster.
- When material and output Product Kinds map to the same inventory account, record successful processing with no journal movement. When accounts differ, Debit finished/output inventory and Credit the differing material inventory accounts by exact scaled consumed cost.
- Keep stock/cost commit atomic. Accounting runs post-commit and fails closed as `NEEDS_CONFIGURATION` when Product Kind or inventory mappings are incomplete.
- Preserve backward compatibility for legacy `outputProductId + batches` manual-production clients.
- Add regression coverage for same-account no-op accounting, multi-account inventory transfer, immutable Recipe Master, dynamic component UI, stock/HPP wiring, and production bridge dispatch.

### Recovery

Migration 0039 is additive. Before deployment, rollback is branch/commit revert. After migration deployment, application rollback may leave the new snapshot columns inert. Posted stock movements, production runs, Accounting deliveries, and journals remain immutable and must be corrected through the existing adjustment/reversal patterns rather than destructive rewrites.

### DOC-IMPACT

**REQUIRED** — changes authoritative manual-production execution semantics and activates the Warehouse -> Accounting production integration boundary.

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