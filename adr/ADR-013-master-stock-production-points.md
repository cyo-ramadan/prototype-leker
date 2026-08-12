# ADR-013 — Master Grouping, Integer Stock, Production & Product Points

Status: Accepted
Date: 2026-08-12

## Context

ADR-012 introduced Item Type, Unit, Recipe/BOM masters and the Admin transaction/accounting boundary. The first UI grouped those masters under a top-level Manufaktur area and recipe quantities allowed scaled decimal storage.

The operational model is refined as follows:

- master entities should be grouped under one Admin **Master** navigation concept;
- Stok and Transaksi are operational read models and must remain outside Master;
- every physical product quantity should be an integer in the smallest chosen base unit;
- products need points per unit, stock policy, recipe-link policy, and STOCK/DADAKAN fulfillment mode;
- DADAKAN sales must produce from the exact recipe revision before the sale stock-out;
- stock movements and production snapshots must be auditable;
- transaction detail must be lazy and historical;
- Accounting remains a separate program currently being integrated by another workstream.

## Decision

### Admin information architecture

Admin groups Barang, Kategori, Supplier, Pelanggan, Kasir/Staf, Tipe Barang, Satuan, and Recipe/BOM under a single **Master** control.

Stok and Transaksi remain top-level operational panels.

The grouping layer reuses existing hidden tab click handlers instead of replacing CRUD listeners.

### Integer physical quantities

Recipe output, recipe components, stock balances, stock movement, production input/output, and sale quantities use integers.

The business must choose a sufficiently small base unit when a larger unit would require fractions. HPP and costing fields may use decimal precision.

### Product policy

Master Barang owns:

- points per unit;
- stock tracking activation;
- STOCK vs DADAKAN mode;
- active recipe-link activation.

Recipe revisions remain separate immutable master records.

### Stock and production

`inventory_stock_balances` remains the current balance table. `stock_movements` is the canonical operational audit read model.

DADAKAN and manual production share `src/stock-production.js`. UI modules must not implement their own BOM calculation.

DADAKAN sale sequence executes atomically in one D1 batch: sale header, production snapshots, component stock-out, output stock-in, sale stock-out, sale item snapshot, points, and lifecycle tracking.

Production is rejected when output or component stock tracking is disabled or when a tracked balance would become negative.

### Points

Points are earned from `points_per_unit × sold quantity` only for an identified customer. Sale items and sale headers snapshot the awarded values. Direct cashier sales use lazy customer identity search; customer-origin orders retain their authenticated customer identity.

### Historical detail

Admin transaction detail may display exact recipe revision and production run snapshots. It may not alter current recipe linkage or product policy.

### Accounting boundary

Prototype Leker adds `PRODUCTION_POSTED` to its Accounting business-fact seam. It does not implement debit/credit interpretation, COA, buku besar, neraca, laba rugi, or closing.

Production HPP/cost snapshot fields are decimal-capable but remain nullable until Inventory/Costing rules are formally defined.

## Consequences

- Legacy products keep stock tracking disabled until Admin initializes them, preventing an abrupt breaking change to historical sales.
- New operational stock behavior becomes enforceable product by product.
- Recipe changes never rewrite transaction history.
- Batch production may leave valid output remainder after a DADAKAN sale.
- Admin list performance remains bounded because customer search, stock history, and transaction detail are lazy.

## Canonical contract

See `contracts/stock-production-points-v1.md`.

This ADR supersedes ADR-012 only where ADR-012 described decimal/scaled physical recipe quantities or a standalone Manufaktur navigation grouping. ADR-012's domain ownership and Accounting boundary remain valid.
