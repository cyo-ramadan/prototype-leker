# Accounting Posting Coverage Audit — 2026-08-18

Change ID: `LEKER-ACC-POSTING-COVERAGE-20260818`
Dikerjakan oleh: `hana1.1` — arsitektur, MAXI agent roster


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

## Finding 2 — Failed facts are never re-driven (corrected)

**Severity: high, but the cause is not the one first recorded here.**

An earlier revision of this audit claimed no re-drive path existed and that building
one was the fix. That was wrong, and building it would have created the second
reconciliation architecture ADR-029 warns against. `POST /api/admin/accounting/bridge/sync`
(`src/accounting-reconciliation-guard.js`) already re-drives failed facts, already skips
voided ones, and already reads its backlog from the fact tables rather than from the
delivery ledger — so it covers Finding 3 as well.

The mechanism exists and is correct. **Nobody has ever run it**, and nothing made anyone
want to: see Finding 6.

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

Fixing configuration does not retroactively post the facts that failed during the gap. The
reconciliation endpoint that would repair this is idempotent and safe to run, but running it
is a manual act, and until Finding 6 was fixed nothing told anyone it was needed.

## Finding 3 — Facts predating the bridge were never backfilled

`store_002`'s two sales were created 2026-08-11T17:44Z. Migration
`0025_accounting_pos_bridge.sql` was applied 2026-08-13T10:38Z. Those sales predate the
delivery ledger, so they produced no delivery row at all.

This is worse than a recorded failure: a reconciliation searching for failed deliveries
would not find them, because there is nothing to find. The existing endpoint already avoids
that trap — it reads its backlog from `sales`, `purchases`, and `expenses` — but the summary
that was supposed to reveal the backlog did not, which is Finding 6.

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

## Finding 6 — The backlog was invisible, so nobody re-drove it (fixed)

`getAccountingBridgeSummary` counted delivery rows by status, and the workspace badge
rendered those counts. A fact with no delivery row appears in none of them, so `store_002`
— two unposted sales, zero delivery rows — displayed `0 posted · 0 perlu setting · 0 gagal`
and read as perfectly healthy.

A correct re-drive button nobody knows to press is not a working recovery path. The summary
now also reports `unsynced`, counted from the fact tables through the same predicate the
reconciliation endpoint uses, and the badge shows `N belum masuk jurnal` when it is non-zero.

Two related defects were fixed alongside it:

- the backlog predicate existed in two copies, and only the newer one excluded voided facts.
  It now has a single definition that both callers import, so the `voided_at` filter cannot
  be present in one and forgotten in the other;
- `POST /api/admin/accounting/bridge/sync` was claimed by two handlers. The shadowed copy in
  `accounting-pos-bridge.js` skipped the voided check, so swapping two lines in `src/index.js`
  would have silently re-enabled re-posting voided transactions. The route now has one owner.

## Finding 7 — Setting Akuntansi reported COMPLETE while sales could not post (fixed)

**This is what made every other finding silent.**

`completeness` was computed from the rule shape alone: at least one active Debit rule and
one active Credit rule. `store_001`'s `sale` category has two of each, so Setting Akuntansi
displayed **Lengkap** — while every sale failed closed, because the things those rules
resolve *through* were not ready.

A status that says complete when nothing can post is worse than no status. The admin has
every reason to stop looking.

Readiness is now computed from what the resolver actually needs, and blockers are matched to
a category by the source types its own active rules use rather than hard-coded per category:

| Blocker | Raised when |
|---|---|
| `NO_ACTIVE_DEBIT_CREDIT` | the category lacks an active side |
| `PAYMENT_METHOD_UNMAPPED` | a `payment_method` rule exists and an active method has no account |
| `PRODUCT_WITHOUT_KIND` | an `item_category_*` rule exists and active products carry no Jenis Barang |
| `PRODUCT_KIND_UNMAPPED` | a Jenis Barang in use has no active `item_categories` row |
| `PRODUCT_KIND_REVENUE_UNMAPPED` | an `item_category_revenue` rule exists and the mapping has no revenue account |

`COMPLETE` now means a fact of that category can actually post. The blockers are rendered in
the category panel, so what is missing is named where it is fixed.

Building the tests surfaced a related fact: **the migration chain never seeds `sale` journal
rules**. In production they were created by hand on 2026-08-16. Every newly migrated store
therefore starts unable to post sales, which is why Finding 4 holds for `store_002` and the
third store. A freshly migrated `store_001` also has `NON_CASH` active with no account and
all 20 active products without a Jenis Barang — three independent reasons a new store cannot
post a sale, none of which were previously visible.

## Recommended order

1. **Run the existing reconciliation** (`POST /api/admin/accounting/bridge/sync`) per store.
   The backlog is now visible in the Accounting workspace, so what needs re-driving is legible
   before anyone presses it. This changes the books and needs Bos Cyo's authority.
2. Configure `sale` rules for `store_002` and the third store. The Setting Akuntansi panel
   now names what each store is still missing.
3. Set Jenis Barang on the product blocking the remaining sale.
4. Decide `payroll` and `deposit`, or record that they stay closed deliberately, as
   `wh_return` already is.

Steps 2–4 are configuration and data, not engineering. The engineering part is done: the
recovery path already existed, and these changes made both the backlog it recovers and the
configuration it needs visible instead of silent.

Still open as an owner decision, deliberately not taken here: whether Leker keeps **perpetual**
inventory, where every sale needs a per-line cost snapshot and posts four legs, or moves to
**periodic**, where a sale posts settlement and revenue only and HPP is computed at period
close. That is an accounting policy with real consequences for mid-period margin and for the
inventory figure on the Neraca, and Constitution R2 puts it with Bos Cyo rather than with an
agent. It does not change the ownership boundary either way.

## Not done here

No production data was mutated. No re-drive was executed. Re-posting historical facts
changes the books and needs explicit task authority from Bos Cyo per Constitution §5.

## DOC-IMPACT

**REQUIRED** — README describes the Penjualan resolver as supporting settlement/revenue/HPP/
inventory legs. That is true of the configuration, but no sale has exercised it in
production. `KNOWN_ISSUES.md` should carry findings 1 and 3–5 until the recorded backlog is
actually re-driven and the remaining stores are configured.
