# Accounting Posting Coverage Audit — 2026-08-18

Change ID: `LEKER-ACC-POSTING-COVERAGE-20260818`

Protocol classification: `TRANSACTION_POTENTIAL: YES` (read-only audit; no production mutation performed)

## Scope

Verify whether the Accounting module is producing correct books for Prototype Leker.
All findings below were taken by read-only query against the live D1
`prototype-leker-db` (`6977b54c-afce-4275-a0ad-d28e7d942e19`) on 2026-08-18.

## What is sound

The ledger itself is clean. These are not assumptions; each was queried:

| Check | Result |
|---|---|
| Journals where debit ≠ credit | 0 |
| Lines whose `store_id` differs from their header | 0 |
| Headers with no lines / lines with no header | 0 / 0 |
| Lines referencing a non-existent or inactive account | 0 |
| Lines using an account belonging to a different store | 0 |
| Journals with fewer than two lines | 0 |
| Reversals pointing at a missing journal | 0 |
| Amounts not a whole multiple of the 1,000,000 scale | 0 |
| System-generated lines using the Rp100 `Penyesuaian` tolerance | 0 |
| Total debit vs total credit | equal (Rp 90,257,032 each) |

The posting engine also fails closed correctly: every fact it could not resolve was
recorded with a reason and **no journal was fabricated**. That is the behaviour ADR-029 and
the Integration Contract Standard require, and it held.

## Finding 1 — No sale has ever reached the books

**Severity: high. The financial statements are currently wrong.**

`sales` holds 8 operational sales. `accounting_journal_headers` holds 15 journals, and not
one of them is a sale. The only REVENUE account ever touched is `4202 Pendapatan Lainnya`,
used twice. Account `Penjualan` has never been credited, and no HPP has ever been debited.

Consequence: Rugi Laba shows Rp 90,100,000 of revenue that is entirely *other income*,
against Rp 52,000 of expense, and zero cost of goods sold. Persediaan is never relieved.
Any reading of profitability from these books today is wrong, not merely incomplete.

Breakdown of the 8 sales:

| Store | Sales | Bridge delivery rows | Outcome |
|---|---|---|---|
| `store_001` | 6 | 6 | all failed: 5 `NEEDS_MAPPING`, 1 `NEEDS_PRODUCT_KIND` |
| `store_002` | 2 | **0** | never reached the bridge at all |

## Finding 2 — Failed facts are recorded but never re-driven

**Severity: high. This is the actual defect.**

The five `NEEDS_MAPPING` failures occurred on 2026-08-13T14:02Z, when the `sale` transaction
category had no journal rules. The rules were created on 2026-08-16T08:01Z and are correct
and complete — all four legs the design calls for:

| Side | Label | Source type |
|---|---|---|
| DEBIT | Pembayaran Penjualan | `payment_method` |
| CREDIT | Pendapatan sesuai Jenis Barang | `item_category_revenue` |
| DEBIT | HPP sesuai Jenis Barang | `item_category_cogs` |
| CREDIT | Persediaan Keluar sesuai Jenis Barang | `item_category_inventory` |

The configuration gap was therefore fixed three days ago. The five sales are still unposted,
because nothing re-drove them: every failed delivery still shows `attempts = 1`.

Fixing configuration does not retroactively post the facts that failed before it. Without a
re-drive path, each configuration gap permanently loses the facts that arrived during it.
The reconciliation capability is described as idempotent, but nothing is driving it.

## Finding 3 — Facts predating the bridge were never backfilled

`store_002`'s two sales were created 2026-08-11T17:44Z. Migration
`0025_accounting_pos_bridge.sql` was applied 2026-08-13T10:38Z. Those sales predate the
delivery ledger, so they produced no delivery row at all.

This is worse than a recorded failure: reconciliation searching for failed deliveries will
not find them, because there is nothing to find. Any backfill must work from `sales`, not
from `accounting_bridge_deliveries`.

## Finding 4 — Sale posting is unconfigured outside store_001

`transaction_categories.code = 'sale'` has **no journal rules at all** in `store_002` and in
`store_ab5c6dd4-3d3c-406b-bde2-d9485bee16ed`. Only `store_001` is configured. Every sale in
those stores will fail closed on arrival.

Also unconfigured in every store: `payroll` and `deposit`. `wh_return` is likewise
unconfigured, which is deliberate — `KNOWN_PITFALLS.md` requires return to fail closed until
its direction is settled.

## Finding 5 — One product still has no Jenis Barang

The single current failure, `NEEDS_PRODUCT_KIND` on 2026-08-16T19:28Z, is legitimate: the
resolver cannot choose Persediaan/HPP/Penjualan accounts for an item with no Jenis Barang,
and correctly refuses to guess. This is a data gap in Master Barang, not a code defect.

## Recommended order

1. **Give failed deliveries a re-drive path.** Without it, findings 1, 3, and 5 cannot be
   cleared even after their causes are fixed. This is the only structural change required.
2. **Backfill from `sales`, not from deliveries**, so facts predating `0025` are included.
3. Configure `sale` rules for `store_002` and the third store.
4. Set Jenis Barang on the product blocking the remaining sale.
5. Decide `payroll` and `deposit`, or record that they stay closed deliberately, as
   `wh_return` already is.

Steps 3–5 are configuration and data. Only step 1 is engineering, and it is what turns a
recorded failure into a recoverable one.

## Not done here

No production data was mutated. No re-drive was executed. Re-posting historical facts
changes the books and needs explicit task authority from Bos Cyo per Constitution §5.

## DOC-IMPACT

**REQUIRED** — README describes the Penjualan resolver as supporting settlement/revenue/HPP/
inventory legs. That is true of the configuration, but no sale has exercised it in
production. `KNOWN_ISSUES.md` should carry findings 1–4 until the re-drive path exists.
