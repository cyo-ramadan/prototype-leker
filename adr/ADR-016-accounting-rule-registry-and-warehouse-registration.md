# ADR-016 — Accounting Rule Registry and Warehouse Registration Boundary

Status: ACCEPTED
Date: 2026-08-13

## Context

Prototype Leker had a provisional Accounting connector that represented one debit-account / credit-account pair per business event and payment method. Bos Cyo approved a more scalable configuration model where transaction categories can contain multiple ordered Debit/Credit rule rows and where Warehouse registers financially relevant transaction categories into the same Accounting Settings registry instead of owning a duplicate account-mapping table.

A separate AI workstream also created PR #3 with older Accounting integration structures. That work was inspected before this change. Its pair-style mapping model and stale branch cannot become a second source of truth beside the newly approved rule registry.

The implementation must also preserve MAXI module boundaries: business applications report/configure business facts; Accounting owns journal interpretation/posting; Warehouse owns operational warehouse configuration and inventory semantics.

## Decision

1. `chart_of_accounts`, `payment_methods`, `item_categories`, `transaction_categories`, and `journal_rules` are the canonical local Settings structures for this Prototype Leker stack.
2. The provisional `accounting_account_refs` and `transaction_accounting_mappings` structures are removed before this undeployed stack is promoted.
3. `transaction_accounting_snapshots` remains as immutable operational evidence of configuration readiness, without debit/credit pair fields.
4. Jenis Barang / `product_kinds` is the product classification hook used by `item_categories`; Tipe Barang remains operational capability metadata.
5. A category is structurally complete only when at least one active Debit and one active Credit rule exist.
6. Structural completeness is not authorization to post a journal. Per-transaction source resolution, amounts, idempotency, Accounting command validation, periods, and posting remain a future journal-generation task.
7. Warehouse Settings owns only warehouse/location, access, and stock-opname configuration.
8. Warehouse registers `wh_transfer`, `wh_opname`, `wh_production`, and `wh_return` into the Accounting `transaction_categories` table using `registered_by_module = WAREHOUSE`.
9. Warehouse does not create an account-mapping table or edit Accounting accounts directly.
10. `wh_transfer`, `wh_opname`, and `wh_production` receive default rule configuration rows; `wh_return` stays fail-closed until return direction/subtype is defined.
11. `Pendapatan Koreksi Stok` and `Beban Susut Persediaan` are seeded as review-required accounts for the stock-opname default configuration.
12. No journal-generation or journal-posting engine is implemented by this change.

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
- PR #3 remains untouched and must not be merged wholesale into this stack without a new reconciliation decision.
- Automatic posting remains safely absent even when a category displays `Lengkap`.

## Compatibility and Migration

This ADR applies to the stacked undeployed branch built on PR #4. Migration 0018 is revised before deployment to remove the provisional pair-mapping tables, and migration 0022 introduces the canonical settings registry.

If any environment has already independently deployed a prior version of migration 0018 containing the removed provisional tables, that environment must not apply this stack blindly. It requires an explicit reconciliation/forward migration because D1 migration filenames are normally applied once. No such remote deployment is authorized by this task.

Rollback before deployment is a branch revert. After Settings data is used, destructive schema rollback is prohibited; recovery must preserve configured rows and use forward migration.

## DOC-IMPACT

**REQUIRED** — Accounting Settings v1, Warehouse Settings v1, Known Issues/Pitfalls, migration 0022, API/UI code, and regression tests are part of the same changeset.
