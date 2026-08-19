# Preflight — Stock Adjustment PILATU Composer Release

Change ID: `LEKER-STOCK-ADJUSTMENT-PILATU-20260819`
Date: 2026-08-19
Classification: UI COMPOSITION / TRANSACTION STAGING
Module: `operasional`
Owner: `karen`

## Requested behavior

Cashier Penyesuaian Stok must use the reusable PILATU interaction pattern. Searching and selecting a product immediately adds a persistent working row. A later selection is prepended above earlier rows instead of replacing them.

Concrete regression case from Bos Cyo:

1. search and select `Mineral`;
2. enter its physical quantity;
3. search and select `Margarin`;
4. expected working rows are `Margarin` then `Mineral`;
5. Qty Sebenarnya already entered for Mineral remains intact.

## Impact assessment

Affected module: Operasional cashier UI only.

- API: no new endpoint and no payload shape change.
- Events: none.
- Database/schema: none.
- Migration: none.
- Accounting: no journal/account/mapping decision.
- Inventory/Costing: no quantity, costing, valuation, or posting-policy change.
- Approval: existing `GOODS_FLOW` + `purpose = STOCK_ADJUSTMENT` request semantics remain authoritative.
- Backward compatibility: existing single-request Stock Adjustment V1 backend remains unchanged; the composer emits independent V1 requests per changed row.
- Security/tenancy: no auth, store isolation, or write-authority change.
- Recovery: revert the UI release; pending approvals and posted stock movements are untouched.

## Scope

- `public/stock-adjustment-pilatu.js`: deterministic PILATU row-state helpers.
- `public/cashier-stock-adjustment-pilatu.js`: isolated cashier override for the Stock Adjustment button.
- `public/cashier.html`: load the override after legacy approval actions.
- `test/stock-adjustment-pilatu.test.js`: executable accumulation and live-wiring regression.
- `package.json`: include both new browser modules in the canonical syntax check only; deploy command remains unchanged.
- `CHANGELOG.md`: record the user-visible behavior change.
- this preflight: evidence and boundaries.

`contracts/stock-adjustment-v1.md` is intentionally not modified in this release. The active contract belongs to Inventory/Costing, while this change is only an Operasional UI composition layer and preserves the existing V1 request semantics.

## Preserved contract behavior

- No database migration.
- No change to `MAXI_STOCK_ADJUSTMENT_V1` request payload semantics.
- No change to Approval Queue authority.
- No change to server-owned stock snapshot or `STOCK_ADJUSTMENT_STALE` guard.
- No change to canonical `inventory_stock_balances`, `inventory_ledger_entries`, or `stock_movements` posting.
- Multi-row UI is not an atomic multi-product backend transaction. Each changed product becomes an independent existing V1 approval request.

## Row anatomy

`Barang | Qty Tercatat | Qty Sebenarnya | HPP | Selisih`

- Barang: read-only identity with row remove control.
- Qty Tercatat: read-only options snapshot presentation; server still re-resolves authoritative stock when the request is staged/approved.
- Qty Sebenarnya: only editable row quantity; maps to `targetQuantity`.
- HPP: read-only presentation. Missing approved binding is shown as `—`; the UI does not invent a value.
- Selisih: presentation derivation `Qty Sebenarnya - Qty Tercatat`.

## Failure behavior

If a multi-row submit partially succeeds because a later request fails, successfully submitted products are removed from the current working set before surfacing the error. Retrying therefore does not silently duplicate the already-created approval requests.

## Concurrency and governance

The original PR #81 predates the active agent-board/module-ownership documentation and carried an Inventory/Costing contract edit. This release is rebuilt from current `main` and drops that cross-module contract change.

The current ChatGPT session does not expose the Cloudflare D1 tool required to write mutable `maxi-agent-bus` claim/report rows. Bos Cyo explicitly approved proceeding with the production release in this session. Compensating controls are: fresh branch from exact current `main`, narrow Operasional-only paths, fresh CI, no direct push to `main`, canonical Cloudflare Git Integration, and evidence-based live validation. Board reporting remains an open coordination follow-up rather than being fabricated.

## Validation required

- `npm run check`;
- `npm test`;
- executable `Mineral -> Margarin` accumulation regression;
- existing Stock Adjustment snapshot/posting/stale tests remain passing through the full suite;
- PR mergeability against current `main`;
- canonical `Workers Builds: prototype-leker-v2` = `SUCCESS` after merge;
- live cashier validation confirms Mineral remains after selecting Margarin.

## DOC-IMPACT

**REQUIRED** — the cashier interaction changes and is recorded in this preflight plus `CHANGELOG.md`; domain transaction semantics remain unchanged.
