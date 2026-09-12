# Category Hierarchy V1

Status: ACTIVE

## Scope

Category hierarchy is store-scoped master-data metadata used to organize products without changing product, inventory, costing, transaction, or accounting semantics.

## Data contract

- `categories.parent_category_id` is nullable.
- `NULL` means the category is a top-level category.
- A non-null parent must reference a category belonging to the same `store_id`.
- A category must not reference itself as parent.
- Existing flat categories remain valid and require no migration to a parent.
- `products.category` remains the existing category-name field for backward compatibility. A product assigned to a child category stores the child category name there.

## Dermo Leker configuration

Parent category: `Leker`.

Active children in display order:

1. `2K` — Leker priced Rp1.500 or Rp2.000.
2. `3K` — Leker priced Rp3.000.
3. `4K` — Leker priced Rp4.000.
4. `5K` — Leker priced Rp5.000.
5. `Special` — Leker priced above Rp5.000.

This classification applies only to the 73 Dermo Leker products provisioned by migration `0083_dermo_leker_catalog_and_recipes.sql`. It does not alter price, purchase price, recipe, stock, HPP, or journal data.

## Compatibility

Consumers that only understand flat categories may continue reading `products.category`. Consumers that understand hierarchy may resolve that category row and follow `parent_category_id` to its top-level category.

DOC-IMPACT: REQUIRED — canonical contract for the new category parent-child capability introduced by migration 0085.
