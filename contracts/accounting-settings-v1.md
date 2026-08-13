# Accounting Settings Contract v1

Status: ACTIVE for Prototype Leker draft implementation
Contract: `MAXI_ACCOUNTING_SETTINGS_V1`

## Purpose

Accounting Settings is the store-scoped configuration registry used to describe accounts, settlement methods, item-account classifications, transaction categories, and debit/credit rule rows before any automatic journal engine exists.

This contract does **not** authorize Prototype Leker to post journals or write to another Accounting database.

## Canonical Storage Conventions

- IDs are stable `TEXT` strings.
- Internal Prototype Leker SQL uses `snake_case`.
- Booleans use `INTEGER` constrained to `0/1`.
- Financial transaction totals remain exact integer money values.
- New unit-cost/HPP facts use exact scaled integers rather than `REAL/FLOAT`.
- Inventory quantity migration to fractional-capable exact decimal is a separate compatibility change.

## Owned Tables

### `chart_of_accounts`

Store-scoped account registry:

- `id`, `store_id`, `code`, `name`;
- `type`: `ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE`;
- `subtype`;
- `is_active`;
- `review_required`;
- audit timestamps.

Account codes are unique per store. Accounts are not hard-deleted by the Settings API. An active referenced account cannot be deactivated until active references are removed or changed.

### `payment_methods`

Store-scoped settlement methods:

- stable `code` and `name`;
- optional `account_id` FK to `chart_of_accounts`;
- active state.

The UI uses account dropdowns. Free-text account identity is not accepted.

Initial methods:

- `CASH` → Kas;
- `BANK` → Bank;
- `PAYABLE` → Utang Usaha.

These are settlement references. They do not themselves generate journal lines.

### `item_categories`

Accounting mapping for the existing Product Master `product_kinds` / Jenis Barang classification:

- one active mapping per `product_kind_id`;
- required Inventory account (`ASSET`);
- required COGS account (`EXPENSE`);
- optional Revenue account (`REVENUE`).

This preserves the explicit business decision that Jenis Barang is the stable product classification hook for Accounting without duplicating Tipe Barang.

### `transaction_categories`

Store-scoped transaction categories with:

- unique stable `code`;
- name and description;
- `involves_payment`;
- `involves_item_category`;
- active state;
- `registered_by_module = ACCOUNTING | WAREHOUSE`.

Initial Accounting categories:

- `sale` — Penjualan;
- `purchase_material` — Pembelian Bahan;
- `operational` — Operasional;
- `payroll` — Gaji;
- `deposit` — Setoran.

These start without invented journal rules so the business owner can link them explicitly.

### `journal_rules`

Each row belongs to one transaction category and defines:

- `label`;
- `side = DEBIT | CREDIT`;
- `source_type`;
- optional `fixed_account_id`;
- active state;
- `sort_order`.

Allowed `source_type` values:

- `fixed_account`;
- `payment_method`;
- `item_category_inventory`;
- `item_category_cogs`;
- `item_category_revenue`;
- `cost_center_cash`.

`fixed_account` requires a same-store account. Other source types may not carry `fixed_account_id`.

## Completeness

A transaction category is visually **Lengkap / COMPLETE** when it has at least one active Debit rule and at least one active Credit rule.

This is a structural Settings check only. It is **not proof that a specific business transaction can be posted**, because a future journal-generation engine must still resolve the actual payment method, Product/Jenis Barang, dimensions, amount, authorization, idempotency, and Accounting command contract for that transaction.

Categories may remain **Belum Lengkap / INCOMPLETE** safely. No fallback account may be guessed.

## Immutable Configuration Snapshot

Operational facts may write a `transaction_accounting_snapshots` row containing:

- source type/id;
- transaction category code;
- payment method code;
- configuration status at fact creation;
- timestamp.

It does not store or post debit/credit journal lines. It exists as audit evidence of configuration readiness at the time the operational fact was recorded.

## UI

Accounting Settings exposes four panels:

1. Chart of Accounts — list/add/edit/deactivate.
2. Payment Methods — account dropdown + active state.
3. Item Categories — Jenis Barang plus Inventory/HPP/Revenue account dropdowns.
4. Transaction Categories & Journal Rules — category list, rule editor, completeness indicator, add Debit/Credit rows, and simple journal preview.

The preview displays configured sources only. It is not a posting simulation and does not calculate journal amounts.

## Seed Accounts

The initial COA contains practical linking references including Kas, Bank, Piutang, inventory accounts, Utang Usaha, Modal, Laba Ditahan, Penjualan, HPP, Beban Operasional, and Beban Gaji.

Warehouse adjustment accounts are also created by the shared settings migration:

- `4201 Pendapatan Koreksi Stok`;
- `6103 Beban Susut Persediaan`.

Both are marked `review_required = 1` because business/accounting ownership must review their suitability before automatic posting is enabled.

## Explicitly Out of Scope

- journal generation;
- posting to General Ledger;
- automatic amount resolution;
- Accounting period enforcement;
- journal reversal;
- financial statement generation;
- direct writes to the separate Accounting program database.

## Compatibility

The old provisional `accounting_account_refs` and pair-style `transaction_accounting_mappings` are superseded before deployment of this stack. The legacy compatibility endpoint is read-only; its old PUT pair-mapping route returns `410 Gone` and directs callers to Accounting Settings.

## DOC-IMPACT

**REQUIRED** — migration 0022, `src/accounting-settings.js`, the compatibility seam, UI, tests, Warehouse Settings contract, and ADR-016 belong to the same settings changeset.
