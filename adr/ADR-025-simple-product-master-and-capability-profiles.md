# ADR-025 — Simple Product Master and Capability Profiles

Status: ACCEPTED
Date: 2026-08-16

## Context

Product Master exposed Category, Tipe Barang, Jenis Barang, Unit, stock policy, costing, and recipe references at the same visual level. A price-only edit could be blocked by a missing or stale technical reference. Manufacturing and Product Master also cached reference data independently, so a newly saved Item Type did not immediately appear in the Product Master selector.

## Decision

1. Keep `item_types` as the canonical capability-profile entity; do not flatten its sell, purchase, production, consumption, and stock rules into duplicated product booleans.
2. Present Item Type to business users as **Peran Barang**.
3. Present Product Kind as **Klasifikasi Accounting** and keep it optional.
4. Keep daily Product Master fields visible and place stock, capability, Accounting classification, points, and recipe references in a collapsible advanced section.
5. Default new products to `FINISHED_GOOD` and `PCS` unless the caller explicitly chooses another active same-store reference.
6. Make Product Master PATCH sparse: omitted fields preserve current stored values.
7. Reference-master writes publish a browser event that invalidates the Product Master editor cache; opening Product Master also performs a fresh reference read.
8. Average Cost and Last Purchase Price remain read-only transaction/costing facts. Editable Master Harga Beli remains independent under ADR-024.

## Scale Boundary

Capability profiles remain extensible for future product roles and service/non-stock behavior. UI labels and defaults may simplify daily operations without changing stable IDs or transaction snapshots. Accounting and Inventory ownership remain unchanged.

## Compatibility and Recovery

This change is API-backward-compatible: existing full Product Master payloads still work. Sparse PATCH is additive. No database migration or destructive rename is required because **Peran Barang** is a presentation label over `item_types`.

## DOC-IMPACT

**REQUIRED** — Product Master contract v4, Current State, UI/API behavior, cache invalidation, and regression tests are updated together.
