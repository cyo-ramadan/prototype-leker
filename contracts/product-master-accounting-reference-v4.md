# Product Master & Accounting Reference Contract v4

Status: ACTIVE for Prototype Leker
Version: 4
Supersedes: `product-master-accounting-reference-v3.md` for editor interaction and PATCH behavior. Purchase-price ownership from v3 remains active.

## Simple editor surface

Daily Product Master fields are product identity, category, editable master purchase price, selling price, image, and active state.

Advanced operational references are:

- Peran Barang (`item_type_id`) — capability profile for sell, purchase, produce, consume, and stock behavior;
- Satuan Dasar (`base_unit_id`);
- Klasifikasi Accounting (`product_kind_id`), optional;
- stock tracking, points, and recipe linkage.

The UI may collapse advanced references. Collapsing them must not clear or rewrite their stored values.

## Defaults

When a new product omits operational references, the server resolves the active same-store `FINISHED_GOOD` Item Type and `PCS` Unit. The browser presents the same defaults. No default Product Kind is invented.

## Sparse PATCH

`PATCH /api/admin/master/products/editor/:id` accepts partial payloads. Every omitted field preserves the current database value. Supplied fields still receive full validation, store-scope checks, inactive-reference checks, and base-unit history guards.

This allows a price-only edit without requiring the browser to resubmit unrelated technical references.

## Reference freshness

After Item Type or Unit writes, the browser invalidates Product Master reference state. Opening Product Master performs a fresh editor read. Newly active references must appear without a full page reload.

## Unchanged ownership

- Master Harga Beli is editable and independent.
- Last Purchase Price and Average Cost remain server-owned.
- Inventory owns stock and HPP mutation.
- Accounting owns journal interpretation.
- Recipe history and transaction snapshots remain immutable.

## DOC-IMPACT

**REQUIRED** — this version records the simplified UI and additive sparse-PATCH contract.
