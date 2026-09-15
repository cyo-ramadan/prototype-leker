# Category Hierarchy V2

Status: ACTIVE
Version: 2
Supersedes: `contracts/category-hierarchy-v1.md`

## What changed from V1

V1 introduced `categories.parent_category_id` but kept it migration-owned
only: "V1 does not expose arbitrary parent-category CRUD." V2 opens that up
to Admin, per Bos Cyo (2026-09-15): "kategori dibikin ada subkategori...
yang sekarang itu dijadikan sub kategori aja." No new column and no second
table were introduced — the same `parent_category_id` column from migration
0085 is now readable and writable through `/api/admin/categories`.

## Scope

Category hierarchy is store-scoped master-data metadata used to organize
products without changing product, inventory, costing, transaction, or
accounting semantics. This is unchanged from V1.

## Data contract

- `categories.parent_category_id` is nullable. `NULL` means the category is
  top-level (a "kategori utama").
- Existing flat categories remain valid and require no parent.
- `products.category` remains the existing category-name field for backward
  compatibility. A product assigned to a child category stores the child
  category name there, exactly as in V1.
- Hierarchy is capped at one level, enforced in `src/admin-multistore.js`
  (`resolveParentCategoryId`), not in a database trigger — this is a product
  rule that could change later, not a data invariant that must be locked at
  the schema layer:
  - A category can only be assigned a parent that is itself top-level
    (`parent_category_id IS NULL`). You cannot nest a category under a
    sub-category.
  - A category that already has children cannot itself be assigned a
    parent. You cannot turn an existing parent into someone else's child.
  - A category cannot be assigned itself as its own parent.
- Store isolation (a parent must belong to the same `store_id` as the child)
  and the self-parent guard are enforced at the database layer by
  `trg_categories_parent_scope_insert`/`_update` (migration 0094), mirroring
  the `trg_products_kind_scope_insert`/`_update` idiom from migration 0019.
  This is an invariant (#5, `CLAUDE.md`), so it is locked at the schema
  layer, unlike the one-level rule above.

## Admin API

- `POST /api/admin/categories` and `PATCH /api/admin/categories/:id` accept
  an optional `parentCategoryId` (integer or `null`). Omitting it, or
  passing `null`/`''`, clears the parent (category becomes/stays top-level).
  An invalid, cross-store, self-referencing, or hierarchy-violating value
  returns `400`, not a silent no-op.
- `GET /api/admin/bootstrap` returns each category's `parentCategoryId`
  directly on the `categories` array. There is no separate
  `categoryGroups`/`category_groups` list or table — a "kategori utama" is
  just a category whose `parentCategoryId` is `null`, and the Admin UI
  derives the parent-picker options by filtering the same array.

## Kasir / Customer consumption

`listProducts()` (`src/db-multistore.js`, shared by both `/api/cashier/menu`
and `/api/menu`) self-joins `categories` to `categories` (child row to its
own `parent_category_id`) and exposes the parent's name on each product as
`categoryGroup` (`null` when ungrouped). `public/menu-category-filter.js` is
the one module both `cashier.js` and `customer.js` use to render the
resulting two-tier (kategori utama -> sub-kategori) chip filter; when no
product in the store has a grouped category, the group row stays hidden and
behavior is identical to the pre-V2 flat single-tier filter.

## Dermo Leker configuration

Unchanged from V1 — parent category `Leker` with children `2K`/`3K`/`4K`/
`5K`/`Special`, provisioned by migration `0083`/`0085`. Migration 0094 adds
no data changes for Dermo, only the two scope-guard triggers.

## Compatibility

Consumers that only understand flat categories may continue reading
`products.category`. Consumers that understand hierarchy resolve that
category row and follow `parent_category_id` to its top-level category —
unchanged from V1.

DOC-IMPACT: REQUIRED — canonical contract for Admin-facing category
hierarchy CRUD introduced by migration 0094.
