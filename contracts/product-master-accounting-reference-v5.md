# Product Master & Accounting Reference Contract v5

Status: ACTIVE for Prototype Leker
Version: 5
Supersedes: `product-master-accounting-reference-v4.md` for Product Master visual ownership. All v4 editor, sparse PATCH, reference freshness, purchase-price, Inventory/Costing, and Accounting ownership rules remain active unless changed below.

## Canonical product visual

Product Master owns the product visual selection through two additive fields with deterministic precedence:

1. `products.image_data` is the explicit custom/uploaded product image and is authoritative when non-empty.
2. `products.image_visual_key` is an optional built-in visual reference used only when `image_data` is empty.

`image_visual_key` is a reference to a versioned visual recipe bundled with the application. It does not imply R2, object storage, Canva runtime access, or any other remote asset provider.

The public menu read model may expose the reference as `imageVisualKey`. Customer menu cards, Game/Roda presentation, and other visual consumers must prefer `imageData` first and then resolve `imageVisualKey`. A consumer may retain a bounded legacy fallback for old products that predate the key, but it must not override an explicit Product Master image.

Changing a product name does not automatically rewrite an existing visual key. The key snapshots the selected built-in visual identity until a dedicated Master action or migration changes it. Uploading a real `image_data` immediately takes precedence without deleting the fallback key.

## Dermo Leker bootstrap

The dedicated Dermo Leker catalog receives `LEKER_V1:<visual identity>` keys in Product Master. Existing Dermo images are preserved. When Dermo is blank and a same-name Pendem Product Master row already has a curated `image_data`, migration may copy that image into Dermo before assigning the built-in fallback key.

This makes the image already presented by the customer menu reusable by Roda Puter without a browser-only name guess and without creating a second visual source of truth.

## Simple editor surface

Daily Product Master fields remain product identity, category, editable master purchase price, selling price, image, and active state. `image_visual_key` is system-managed in v5 and does not need to become a manual text field in the daily editor.

Advanced operational references remain Peran Barang (`item_type_id`), Satuan Dasar (`base_unit_id`), optional Klasifikasi Accounting (`product_kind_id`), stock tracking, points, and recipe linkage.

## Sparse PATCH and unchanged ownership

Sparse PATCH behavior from v4 remains unchanged. Omitted fields preserve their current database values. Existing Product Master write paths that do not mention `image_visual_key` must not clear it.

Master Harga Beli remains editable and independent. Last Purchase Price and Average Cost remain server-owned. Inventory owns stock and HPP mutation. Accounting owns journal interpretation. Recipe history and transaction snapshots remain immutable.

## Compatibility

The change is additive and backward-compatible. Existing products with only `image_data` continue to render identically. Existing products with neither visual field keep their existing generic/default fallback until explicitly configured.

## DOC-IMPACT

**REQUIRED** — v5 records Product Master ownership and precedence for explicit images versus built-in visual references, plus the additive public menu field used by Game/Roda presentation.
