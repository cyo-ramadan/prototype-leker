# ADR-030 — Entity owns the books; tenancy and consolidation are resolved relations

Status: ACCEPTED
Date: 2026-08-18
Change ID: `MAXI-TENANCY-CONSOLIDATION-20260818`

## Context

MAXI is a multi-tenant SaaS platform (Constitution §10). Prototype Leker is its first
Business Application and today has no tenancy dimension at all: isolation is
`store_id`, which is a **gerai** — an operational outlet, not a subscribing company.

The owner stated the target shape directly:

- one MAXI customer has 3 operating units, another has 5;
- each unit keeps **its own accounting and its own stock**;
- the units of one customer are **connected for central accounting**;
- and at some point two such customers may **merge into one**.

This exposes a vocabulary collision that must be settled before any schema is written.
The owner calls each operating unit a "tenant". Constitution S2 and Integration Contract
Standard §12 define `tenantId` as *the subscribing customer company*, and explicitly keep
business unit, branch, and warehouse as separate concepts. Both meanings cannot survive in
one schema; leaving them merged would make every future table and contract ambiguous, and
Constitution §4 prohibits silent alignment when sources conflict.

The merge requirement is the sharpest constraint, and it collides with an existing
invariant. R7 and Prototype Leker's own rule state that **posted journals are immutable**.
If tenant or group identity were stamped onto journal rows, merging two customers would
require rewriting posted journals — a direct violation. The immutability invariant and the
merge requirement therefore point at the same design, and that design is not optional.

## Decision

### 1. Four named levels, one meaning each

| Level | Meaning | Owns |
|---|---|---|
| **Tenant** | The MAXI subscriber (customer company). Constitution S2 meaning, unchanged. | Subscription, entitlement, hard isolation boundary |
| **Entity** (Badan Usaha) | The unit that keeps its own books. This is what the owner called a "tenant". | Chart of Accounts, journals, stock, valuation |
| **Consolidation Group** | A set of entities reported together as central accounting. | Group CoA mapping, elimination rules |
| **Store** (Gerai) | Operational outlet. Existing `store_id`, meaning unchanged. | Operational transactions, drawer, cashier |

A store belongs to exactly one entity. An entity belongs to exactly one tenant at any given
time. A tenant has one or more entities.

### 2. The ledger anchors to Entity, and only to Entity

Journal headers and lines, stock movements, stock balances, and valuation rows carry
`entity_id`. They **do not** carry `tenant_id` or `group_id`.

This is the load-bearing rule. Entity identity never changes across a merge, so anchoring
the ledger to it means a merge never touches a posted journal. Denormalising tenant or
group onto ledger rows would make every merge a rewrite of immutable records.

### 3. Tenancy and grouping are temporal relations, resolved at read time

```
entity_tenancy(entity_id, tenant_id, effective_from, effective_to)
consolidation_membership(entity_id, group_id, effective_from, effective_to)
```

Membership is closed and reopened, never overwritten. A merge of two customers is a
platform operation that closes the old `entity_tenancy` rows and opens new ones pointing at
the surviving tenant. No operational or financial row is rewritten.

### 4. Isolation is enforced by resolving the entity set server-side

Per Constitution S3, tenant context is never taken from the client. Every read, write,
event, job, cache key, export, and reconciliation path resolves the authorised entity set
from the verified tenant context, then filters on `entity_id`. A query that filters only by
`store_id` is not tenant-safe and does not satisfy S3.

### 5. Consolidation is a read-side concern

Each entity posts its own journals into its own Chart of Accounts. Central accounting does
not post into entity books and entity books do not post into a group ledger. A consolidated
report resolves membership **as of the reporting period**, maps each entity account to the
group Chart of Accounts through a versioned mapping, and applies eliminations.

### 6. Intercompany requires an explicit counterparty

A fact that crosses two entities inside a group records `counterparty_entity_id`.
Without it, eliminations cannot be computed and consolidated revenue and stock silently
double-count. Cross-entity stock transfer is a business fact between two entities, not an
internal stock movement.

### 7. Restatement is explicit, never implicit

Because membership is temporal, a consolidated report for a period before a merge reflects
the structure that existed in that period. Presenting pre-merge periods under the post-merge
structure is a **restatement**: a separate, explicitly requested, audited operation. It is
never applied silently as a side effect of a merge.

### 8. Migration into Leker is additive and staged

Constitution C8 prohibits a big-bang rewrite, so:

1. introduce `tenants`, `entities`, `entity_tenancy`, `consolidation_groups`,
   `consolidation_membership` as new tables; change nothing existing;
2. backfill one entity per existing store — today a gerai already owns its own accounting
   configuration and journals, so gerai is the de facto books-owner — and place every
   existing entity under a single prototype tenant;
3. add `entity_id` alongside `store_id` on ledger tables, backfilled from the store's
   entity, both columns live;
4. move reads and writes onto `entity_id` behind compatibility ports, keeping `store_id` as
   the operational scope it already is;
5. add the group Chart-of-Accounts mapping and the consolidation read layer last.

Steps 1–3 are backward compatible and safe to land while Leker is single-tenant.

## Consequences

- A customer merge becomes a membership change, not a data migration. This is the property
  the whole design exists to buy.
- `store_id` stops carrying two meanings. It remains operational scope; it stops being an
  implied books boundary.
- Every existing query that treats `store_id` as the isolation boundary becomes incomplete
  once a second tenant exists. Step 4 is therefore not optional cleanup — it is the work
  that makes MAXI safe to sell to a second customer.
- Consolidated reports stay correct across structural change, because membership is dated.
- Intercompany elimination becomes possible; without decision 6 it would not be.
- Posted journals and the six-decimal scaled-integer money rule are untouched.

## Open decisions owned by Bos Cyo

These are business and accounting policy, not architecture, and are deliberately left open:

1. **Does central accounting need its own legal books?** If the group is itself a reporting
   entity that must post real consolidating journals, a group-level ledger is required.
   This ADR assumes reporting-only consolidation.
2. **Restatement policy on merge.** Whether pre-merge comparatives are restated, and from
   which date, is an accounting decision.
3. **Fiscal calendar alignment.** Consolidation across entities with different fiscal
   period boundaries needs a stated rule before the read layer is built.
4. **Money scale at the contract boundary.** Leker stores `1 rupiah = 1,000,000` units;
   Integration Contract Standard §6 says IDR uses integer minor units *according to
   contract*. The canonical scale must be written into the contract before entities exchange
   facts, or consolidation will inherit a silent conversion error.

## Related

- Constitution §10 (SaaS Multi-Tenant Product Direction), §11 (Composable Modules)
- Integration Contract Standard §12 (SaaS Tenant Boundary)
- `ADR-029` — Operasional reports facts; Accounting resolves journals
- `ADR-003` — branch admin, drawer, and customer sharing

## DOC-IMPACT

**REQUIRED** — README gains the four-level vocabulary once step 1 lands. `KNOWN_PITFALLS.md`
gains the rule that `store_id` alone is not a tenant boundary. Any new table added before
step 3 must be reviewed against decision 2, because a ledger table created without
`entity_id` becomes migration debt the moment a second tenant exists.
