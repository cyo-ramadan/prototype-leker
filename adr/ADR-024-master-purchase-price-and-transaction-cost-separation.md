# ADR-024 — Master Purchase Price and Transaction Cost Separation

Status: ACCEPTED
Date: 2026-08-16
Supersedes in part: ADR-015 where `products.purchase_price` is described as a compatibility mirror of the latest purchase.

## Context

The cashier purchase composer needs a stable default purchase price before a transaction exists. The deployed Product Master editor hid the existing `products.purchase_price` field and forced new products to `0`. Purchase posting also overwrote that field with the latest transaction price, so the master default had no independent ownership.

## Decision

1. `products.purchase_price` is the editable, store-scoped Master Barang purchase-price default.
2. Cashier purchase options use `products.purchase_price` as the current default; the cashier may still edit the transaction price before adding the line.
3. `products.last_purchase_price` remains a server-owned exact scaled value derived only from itemized purchase transactions.
4. `products.average_cost` remains the running HPP source and is not changed by editing the master purchase price.
5. Before any purchase transaction exists, UI may present Harga Beli Terakhir as temporarily following the master purchase price, while `last_purchase_at` remains null and no transaction evidence is invented.
6. Purchase posting and purchase correction must never overwrite `products.purchase_price`.
7. Existing rows with an empty master purchase price may be bootstrapped once from real last-purchase evidence.

## Consequences

- Admin can maintain a useful default price independently from HPP and transaction history.
- Cashier receives a non-empty default after the master value is configured.
- Future source selection may offer Master Price versus Last Purchase Price explicitly without changing either source's meaning.

## Compatibility and Recovery

Migration `0032_master_purchase_price.sql` performs a non-destructive one-time bootstrap only where `purchase_price = 0` and real last-purchase evidence exists. Application rollback may ignore the editable behavior; data rollback must not delete either price source.

## DOC-IMPACT

**REQUIRED** — Product Master contract v3, Current State/README, Known Issues, UI/API behavior, purchase/correction writers, migration, and regression tests are updated together.
