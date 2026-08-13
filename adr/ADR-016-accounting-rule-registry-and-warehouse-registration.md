# ADR-016 — Accounting Rule Registry and Warehouse Registration Boundary

Status: ACCEPTED
Date: 2026-08-13

## Context

Prototype Leker had a provisional Accounting connector that represented one debit-account / credit-account pair per business event and payment method. Bos Cyo approved a more scalable configuration model where transaction categories can contain multiple ordered Debit/Credit rule rows and where Warehouse registers financially relevant transaction categories into the same Accounting Settings registry instead of owning a duplicate account-mapping table.

A separate AI workstream also created PR #3 with older Accounting integration structures. That work was inspected before this change. Its pair-style mapping model and stale branch cannot become a second source of truth beside the newly approved rule registry.

The implementation must also preserve MAXI module boundaries: business applications report/configure business facts; Accounting owns journal interpretation/posting; Warehouse owns operational warehouse configuration and inventory semantics.

## Decision

1. `chart_of_accounts`, `payment_methods`, `item_categories`, `transaction_categories`, and `journal_rules` are the canonical local Settings structures for this Prototype Leker stack.
2. The provisional `accounting_account_refs` and `transaction_accounting_mappings` schema from migration 0018 is retained only for migration/history compatibility; the current application no longer uses it as configuration source or writer.
3. `transaction_accounting_snapshots` remains immutable operational evidence. Migration 0023 extends the existing 0018 table with canonical transaction-category/payment/configuration-readiness fields while retaining the old required columns for forward compatibility.
4. New snapshot writers leave legacy mapping/account-reference FKs NULL and store the canonical readiness fields as authoritative metadata.
5. Migration 0023 disables the legacy new-store seed trigger so newly created stores do not continue receiving obsolete pair-mapping rows.
6. Jenis Barang / `product_kinds` is the product classification hook used by `item_categories`; Tipe Barang remains operational capability metadata.
7. A category is structurally complete only when at least one active Debit and one active Credit rule exist.
8. Structural completeness is not authorization to post a journal. Per-transaction source resolution, amounts, idempotency, Accounting command validation, periods, and posting remain a future journal-generation task.
9. Warehouse Settings owns only warehouse/location, access, and stock-opname configuration.
10. Warehouse registers `wh_transfer`, `wh_opname`, `wh_production`, and `wh_return` into the Accounting `transaction_categories` table using `registered_by_module = WAREHOUSE`.
11. Warehouse does not create an account-mapping table or edit Accounting accounts directly.
12. `wh_transfer`, `wh_opname`, and `wh_production` receive default rule configuration rows; `wh_return` stays fail-closed until return direction/subtype is defined.
13. `Pendapatan Koreksi Stok` and `Beban Susut Persediaan` are seeded as review-required accounts for the stock-opname default configuration.
14. No journal-generation or journal-posting engine is implemented by this change.

## Data Conventions

- settings IDs are stable `TEXT` values;
- Leker persistence naming remains `snake_case`;
- booleans use constrained `INTEGER 0/1`;
- money and costing must remain exact, with no new binary floating-point financial source of truth;
- stock-opname quantity tolerance may use canonical decimal text;
- the current inventory stock engine remains integer until its dedicated fractional-quantity compatibility migration.

## Consequences

- Business transaction mapping can evolve from simple two-line journals to multiple rule rows without redesigning the Settings schema.
- Payment methods resolve settlement accounts through data rather than free-text account input.
- Jenis Barang can later resolve inventory/HPP/revenue accounts consistently.
- Warehouse Accounting references live in one registry and remain visible/editable from Accounting Settings.
- Legacy 0018 tables may physically exist after deployment but are inert compatibility schema, not a second active mapping engine.
- PR #3 remains untouched and must not be merged wholesale into this stack without a new reconciliation decision.
- Automatic posting remains safely absent even when a category displays `Lengkap`.

## Compatibility and Migration

This ADR applies to the stacked branch built on PR #4.

PR #4 migration history is preserved unchanged. This is intentional: a parent stacked PR may be deployed independently, and D1 does not rerun an already-applied migration filename just because a child branch later changes its contents.

Migration 0022 introduces the canonical Settings registry. Migration 0023 then extends the existing `transaction_accounting_snapshots` table, backfills canonical readiness metadata from legacy fields, and disables the old per-store pair-mapping seed trigger.

This forward strategy works whether 0018 is first applied as part of the complete stack or was already applied by PR #4 before the child Settings stack. No destructive drop of historical snapshot data is required.

Rollback before deployment is a branch revert. After Settings data is used, destructive schema rollback is prohibited; recovery must preserve configured rows and use forward migration.

## DOC-IMPACT

**REQUIRED** — Accounting Settings v1, Warehouse Settings v1, Known Issues/Pitfalls, migrations 0022–0023, API/UI code, and regression tests are part of the same changeset.
