# Pendem E2E Transaction Cycle — Corrected Execution Result

Task: `karen-LEKER-QA-PENDEM-TRANSACTION-CYCLE`  
Executor lane: Karen takeover of `karen15` per direct Bos Cyo instruction  
Branch: `karen15/pendem-transaction-cycle-qa`  
PR: #170  
Status: **BLOCKED — PENDEM PRODUCTION MASTER DATA / STOCK READINESS**

## Correction to the first QA assumption

The first QA runner used an incorrect business-flow assumption: it tried to link direct purchases of `Bubuk Rasa Mangga` / `Bubuk Rasa Apel` straight to finished-drink sales.

Bos Cyo corrected the intended operational flow. The correct flow is:

1. buy the actual raw materials required by the canonical semi-finished recipe, such as sugar/tea/water where the recipe requires them;
2. run **Production** to turn those raw materials into semi-finished stock such as `Larutan Gula` and `Larutan Teh Poci Vanilla`;
3. record the required operational expenses;
4. only then sell finished drinks whose recipe consumes the prepared semi-finished materials and other components.

The earlier `RECIPE_MATERIAL_NOT_PURCHASABLE: Bubuk Rasa Mangga` failure is therefore retained only as evidence of the invalid first QA attempt. It is **not** the authoritative root-cause diagnosis.

## What the repository currently says

Migration `0056_pendem_es_teh_poci_catalog_and_recipes.sql` explicitly classifies `Larutan Teh Poci Vanilla` and `Larutan Gula` as processed **Barang Setengah Jadi**, not raw materials to buy directly.

The same migration also states that:

- those two semi-finished items were absent from `DATA_BARANG.xlsx` and were added because they occur as components in the imported finished-drink recipes;
- all newly imported Pendem products were created with `stock_tracking_enabled = 0` until opening stock is correctly initialized;
- only three finished-drink recipes were imported from `RESEP_ES_TEH_POCI.xlsx`.

In the current canonical repo migration, no production recipe is defined whose output is `Larutan Gula` or `Larutan Teh Poci Vanilla`, and the imported raw-material list does not include a standalone `Gula` product. Karen will not invent those missing master facts or recipe quantities.

## Live production probe

After Bos Cyo corrected the flow, Karen ran a read-only production probe against the live Pendem cashier API.

GitHub Actions workflow run: `33364474403` / run #615  
Quality job: `99402180998`

Probe:

- login: production Pendem cashier API succeeded;
- `GET /api/cashier/production/options`: HTTP 200;
- returned runnable production options: `[]`;
- returned runnable Larutan recipes: `[]`.

Exact log evidence:

```text
PENDEM_PRODUCTION_OPTIONS=[]
PENDEM_LARUTAN_RECIPES=[]
```

The run remained green:

- `npm run check`: **PASS**;
- `npm test`: **408 total / 407 PASS / 0 FAIL / 1 SKIP**;
- the original one-shot transaction mutation test stayed skipped because this result file already exists.

The read-only probe made no purchase, production, expense, or sale mutation.

## Current blocker

The corrected end-to-end cycle cannot yet be executed honestly on live Pendem because the cashier Production surface currently exposes **zero runnable production recipes**.

With Warehouse enabled, Production requires a runnable active recipe and stock-tracked participating products. The current Pendem import intentionally left its new products untracked until opening-stock initialization, and the repo does not contain the missing upstream Larutan production recipe/master facts required to turn raw materials into those semi-finished outputs.

Therefore the next valid step is to make the Pendem manufacturing master complete and stock-ready using authoritative recipe data, then execute the QA sequence through public APIs:

`Purchase raw materials → Production Larutan → Operational Expense → Sale finished drink`.

Karen will not make up `Gula`, recipe quantities, opening stock, stock-tracking changes, or manufacturing recipes merely to force the QA test through.

## Production mutation evidence

From the original run #613:

- the production Worker was reached and login succeeded;
- execution stopped before the six target transaction write loops;
- no purchase, expense, or sale carrying marker `QA-PENDEM-E2E-KAREN15` was committed.

A drawer may already have existed or may have been opened by the prerequisite path. The original run did not capture enough evidence to distinguish those cases, so this report does not invent drawer provenance.

## Required resolution

Provide/restore the authoritative Pendem semi-finished production master, specifically the canonical raw-material identities and quantities for the Larutan recipes, then initialize the participating stock-tracking/opening-stock state according to Warehouse policy.

Once those facts are present, rerun this QA cycle using the same public application boundaries. Do not bypass Production and do not disable Warehouse merely to make the test pass.

## DOC-IMPACT

`DOC-IMPACT: NOT_REQUIRED` — this branch changes QA evidence only. It does not change runtime code, schema, manufacturing policy, recipe master, Inventory policy, or Accounting behavior.
