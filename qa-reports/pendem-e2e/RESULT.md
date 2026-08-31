# Pendem E2E Transaction Cycle — Execution Result

Task: `karen-LEKER-QA-PENDEM-TRANSACTION-CYCLE`  
Executor lane: Karen takeover of `karen15` per direct Bos Cyo instruction  
Branch: `karen15/pendem-transaction-cycle-qa`  
PR: #170  
Status: **BLOCKED — INVENTORY CONFIGURATION**

## Required cycle

Target production cycle was:

1. two cashier purchases;
2. two cashier operational expenses;
3. two cashier sales;
4. purchases and sales materially related through Pendem recipe components;
5. all writes through the public application API, never direct D1.

The intended linked pair was:

- purchase `Bubuk Rasa Mangga` → sell `Es Teh Mangga Besar`;
- purchase `Bubuk Rasa Apel` → sell `Es Teh Apel Besar`.

Both finished products have active recipe links in migration `0056_pendem_es_teh_poci_catalog_and_recipes.sql`.

## Production execution evidence

GitHub Actions workflow run: `33360738845` / run #613  
Quality job: `99391455512`

- `npm run check`: **PASS**
- `npm test`: **406 PASS / 1 FAIL**
- failing test: `Pendem production transaction cycle: 2 purchases + 2 expenses + 2 linked sales`
- exact live failure:

```text
RECIPE_MATERIAL_NOT_PURCHASABLE: Bubuk Rasa Mangga; warehouseEnabled=true; purchasable=Teh Vanilla
```

The QA runner successfully reached the production Worker, authenticated as the Pendem pilot cashier, obtained an owned/open drawer context, and called the live purchase-options API. It failed closed before the purchase loop because the required recipe material was not eligible for cashier purchase.

No purchase, expense, or sale from marker `QA-PENDEM-E2E-KAREN15` was committed by this run. The assertion occurs before all six transaction write loops.

A drawer may already have existed or may have been opened by the QA prerequisite path; the first run did not emit enough evidence to distinguish those two cases, so this report does not invent that provenance.

## Repository ↔ production consistency

The live result matches the current repository rules:

1. Pendem is created with `warehouse_enabled = 1` in migration `0052_leker_new_stores_kantor_pendem_mandala.sql`.
2. The imported Pendem Es Teh Poci products in migration `0056_pendem_es_teh_poci_catalog_and_recipes.sql` were intentionally created with `stock_tracking_enabled = 0` until opening stock is initialized.
3. `src/cashier-purchase.js` exposes only `stock_tracking_enabled = 1` purchasable products while Warehouse is enabled.
4. Production currently returned only `Teh Vanilla` as purchasable. Therefore both intended recipe-linked purchase materials, `Bubuk Rasa Mangga` and `Bubuk Rasa Apel`, are outside the cashier purchase surface.

## Why Karen did not bypass it

Changing `stock_tracking_enabled`, opening stock, Warehouse policy, or substituting an unrelated purchasable product would be an Inventory/Costing policy/configuration mutation outside this QA task's authorized report path (`qa-reports/pendem-e2e`). It would also change the meaning of the requested linked transaction cycle.

The QA runner therefore fails closed instead of fabricating a successful six-transaction cycle.

## Required resolution

Inventory owner / Bos Cyo must decide and authorize the Pendem stock-initialization path for the recipe components that should participate in the QA cycle. The narrowest coherent route is to initialize/enable stock tracking for the actual recipe components, then rerun this cycle through the same public APIs.

Disabling Warehouse merely to make the QA pass is **not recommended** because Pendem was explicitly provisioned with Warehouse enabled and would weaken the intended inventory behavior.

## DOC-IMPACT

`DOC-IMPACT: NOT_REQUIRED` — this changes no product contract, runtime code, schema, or operating policy. It records production QA evidence only.
