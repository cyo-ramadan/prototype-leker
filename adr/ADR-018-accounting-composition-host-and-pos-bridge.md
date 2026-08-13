# ADR-018 — Accounting Composition Host and POS Bridge

Status: ACTIVE
Date: 2026-08-13

## Context

Prototype Leker originally exposed only an Accounting business-fact seam and a placeholder connection state. Subsequent product decisions separated two concerns explicitly:

1. **Akuntansi** is the work module where accounts, journals, ledger, Profit & Loss, and Balance Sheet are operated.
2. **Setting Akuntansi** is configuration only: it maps transaction components, payment methods, and Jenis Barang to Accounting-owned accounts.

Bos Cyo also requires Data Jurnal to contain both manual journals and journals generated from system/POS transactions after those transactions are linked through Settings.

The shared MAXI Accounting module `@maxi/accounting@1.3.0` is the canonical architecture target, but the shared service is not deployed into Prototype Leker today.

## Decision

Prototype Leker will host a **local Accounting composition implementation** that follows the canonical Accounting ownership and data rules while keeping an explicit future adapter boundary to the shared module.

The local host is not permission for POS, Warehouse, or Settings to own Accounting behavior.

### Module ownership

Accounting owns:

- account creation/maintenance;
- automatic unique account-code generation;
- balanced journal posting;
- journal immutability/reversal semantics;
- Data Jurnal;
- General Ledger;
- Profit & Loss;
- Balance Sheet.

Setting Akuntansi owns:

- payment-method mappings;
- Jenis Barang mappings;
- transaction-category/rule configuration.

POS owns committed operational facts only.

Integration Bridge owns:

- reading committed facts;
- reading approved Settings references;
- resolving them into an Accounting command;
- fail-closed mapping validation;
- idempotent dispatch/retry state;
- journal-reference reconciliation.

### One journal source

Manual journal entry and bridge-generated POS journals call the same Accounting posting function and persist into the same journal header/line source.

Financial reports are calculated only from posted Accounting journals, not independently from POS transaction tables.

### Post-commit bridge

POS facts are committed before Accounting dispatch.

A missing Accounting mapping must not roll back or duplicate a valid operational POS transaction. The bridge records `NEEDS_CONFIGURATION`/`FAILED` and supports retry by source fact.

### Financial representation

Journal amounts use exact INTEGER `amountMinor`. Binary floating point is prohibited as a new Accounting source of truth.

### Scaled HPP blocker

Sale HPP is stored in exact scaled cost units. No canonical conversion/rounding rule to journal `amountMinor` has yet been approved. Sale COGS/inventory journal resolution therefore fails closed with `NEEDS_COST_ROUNDING_POLICY` rather than silently rounding.

### Current scope identity

Prototype persistence remains store-scoped. The public/module architecture must remain adaptable toward canonical `tenantId`; store-scoped storage is a composition detail, not a new shared-platform convention.

## Consequences

Positive:

- Accounting work is usable before the shared Accounting service is physically deployed.
- Settings can be tested against actual journal output.
- Manual and system journals reconcile in one ledger/report source.
- POS remains operational even when Accounting configuration is incomplete.
- The future shared-module cutover can replace the composition adapter rather than rewriting POS business logic.

Costs/constraints:

- the prototype temporarily hosts Accounting persistence locally;
- account bootstrap codes created by earlier Settings migrations coexist with new server-generated `ACC-xxxxxx` codes;
- dynamic cashier payment-method/component UX remains a follow-up;
- HPP journal posting remains blocked until precision conversion is approved.

## Rejected Alternatives

### Let POS write journal tables directly

Rejected because it transfers Accounting ownership into POS and makes later module separation expensive.

### Maintain a second POS account-mapping table

Rejected because the canonical Settings registry is already the source of mapping truth.

### Roll back POS transaction when Accounting mapping is incomplete

Rejected because a valid business fact must not be duplicated by cashier/client retry merely because downstream Accounting configuration is missing.

### Recalculate financial reports directly from POS sales/purchases

Rejected because manual and system journals would then have competing financial sources of truth.

### Guess HPP rounding

Rejected because rounding/truncation is an accounting policy decision and no canonical rule has been approved.

## Related

- ADR-016 — Accounting Rule Registry and Warehouse Registration
- ADR-017 — Accounting Work vs Settings Ownership
- `contracts/accounting-workspace-v1.md`
- `contracts/accounting-pos-bridge-v1.md`
- `migrations/0024_accounting_workspace.sql`
- `migrations/0025_accounting_pos_bridge.sql`

## DOC-IMPACT

REQUIRED — this ADR records the architecture rationale; implementation state and unresolved blockers belong in Current State / Known Issues rather than rewriting this decision history.
