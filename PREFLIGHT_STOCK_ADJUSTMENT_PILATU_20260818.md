# Preflight — Stock Adjustment PILATU Composer

Change ID: `LEKER-STOCK-ADJUSTMENT-PILATU-20260818`
Date: 2026-08-18
Classification: UI COMPOSITION / TRANSACTION STAGING

## Requested behavior

Cashier Penyesuaian Stok must use the reusable PILATU interaction pattern. Searching and selecting a product immediately adds a persistent working row. A later selection is prepended above earlier rows instead of replacing them.

Concrete regression case from Bos Cyo:

1. search and select `Mineral`;
2. search and select `Margarin`;
3. expected working rows are `Margarin` then `Mineral`;
4. any Qty Sebenarnya already entered for Mineral remains intact.

## Scope

- `public/cashier-approval-actions.js`: live cashier panel composition and submission loop.
- `public/stock-adjustment-pilatu.js`: deterministic PILATU row-state helpers.
- `test/stock-adjustment.test.js`: executable accumulation regression plus existing backend guards.
- `contracts/stock-adjustment-v1.md`: clarify that multi-row UI composition emits independent V1 approval requests.
- `package.json`: syntax-check the new browser module.
- `CHANGELOG.md`: record behavior change.

## Preserved contracts

- No database migration.
- No change to `MAXI_STOCK_ADJUSTMENT_V1` per-request API payload.
- No change to Approval Queue authority.
- No change to server-owned stock snapshot or `STOCK_ADJUSTMENT_STALE` guard.
- No change to canonical `inventory_stock_balances`, `inventory_ledger_entries`, or `stock_movements` posting.
- Multi-row UI is not an atomic multi-product backend transaction. Each changed product becomes an independent approval request and retains its own stale guard.

## Row anatomy

Business columns:

`Barang | Qty Tercatat | Qty Sebenarnya | HPP | Selisih`

- Barang: read-only identity; remove control lives inside this cell.
- Qty Tercatat: read-only stock options snapshot.
- Qty Sebenarnya: only editable row value; maps to `targetQuantity`.
- HPP: read-only presentation reference; unavailable values are shown explicitly rather than fabricated.
- Selisih: derived `Qty Sebenarnya - Qty Tercatat`.

## Failure behavior

If a multi-row submit partially succeeds because a later request fails, successfully submitted products are removed from the current working set before surfacing the error. This prevents an immediate retry from silently duplicating already-created approval requests.

## Validation required

- `npm run check`
- `npm test`
- executable `Mineral -> Margarin` accumulation regression
- existing Stock Adjustment snapshot/posting/stale tests remain passing

DOC-IMPACT: REQUIRED — UI composition changed while transaction semantics remain preserved.
