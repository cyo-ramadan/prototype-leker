# ADR-021 — Accounting Flow Counterpart Presets and Warehouse Routing Boundary

Status: ACTIVE
Date: 2026-08-13

## Context

Prototype Leker already has canonical Setting Akuntansi registries for Chart of Accounts references, Payment Methods, Jenis Barang mappings, Transaction Categories, and ordered Journal Rules. Warehouse Settings already owns Warehouse/location definitions and access configuration.

Bos Cyo clarified the intended bookkeeping direction:

- cash in increases Kas on Debit;
- cash out decreases Kas on Credit;
- the opposite account must be configurable from Setting Akuntansi;
- goods movements must affect Persediaan without automatically being treated as profit/loss when the configured counterpart is a balance-sheet account;
- warehouse choices must reuse the Warehouse module rather than creating another warehouse system.

A key implementation constraint is that current canonical physical stock is still store-scoped. `inventory_stock_balances` does not yet identify source/destination warehouse.

## Decision

### Reuse existing Accounting Settings registries

No new mapping table is created.

A transaction-centric UI extension provides safe quick presets that create/update the existing `transaction_categories` and `journal_rules` only.

### Cash flow presets

`cash_flow_in`:

- Debit `payment_method`;
- Credit selected `fixed_account`.

`cash_flow_out`:

- Debit selected `fixed_account`;
- Credit `payment_method`.

The future approved Cash Flow business fact will resolve the cash side through the configured CASH Payment Method rather than hardcoding an account ID in the cashier client.

### Goods flow presets

`goods_flow_in`:

- Debit `item_category_inventory`;
- Credit selected `fixed_account`.

`goods_flow_out`:

- Debit selected `fixed_account`;
- Credit `item_category_inventory`.

This keeps Persediaan account ownership in Jenis Barang mapping and lets the administrator decide the business meaning of the counterpart account.

Choosing ASSET/LIABILITY/EQUITY keeps the pair outside direct P&L classification. Choosing REVENUE/EXPENSE intentionally affects Profit & Loss.

### No silent overwrite

If a canonical preset category already has a customized active rule shape, the preset refuses to overwrite it. The existing Aturan Transaksi editor remains the manual override surface.

### Warehouse routing is intentionally HOLD

The UI reads active Warehouse references from Warehouse Settings, but it does not claim source/destination stock execution.

Reason: physical stock is currently store-level, so accepting a warehouse selector as if it were operationally authoritative would create false audit semantics.

Warehouse-level stock routing requires a separate Inventory/Warehouse contract that extends the canonical stock model. Accounting will consume source/destination facts from that module later.

### Posting remains separate

These presets configure journal interpretation shapes. They do not themselves post journals and do not activate CASH_FLOW/GOODS_FLOW Accounting delivery.

A future bridge must consume approved operational facts with exact valuation context. Generic goods quantity must never be valued using mutable current Product Master cost at journal-posting time.

## Consequences

Positive:

- Cash flow Debit/Credit direction becomes easy to configure correctly.
- Inventory movement can be paired with non-P&L accounts without inventing gain/loss.
- Existing Accounting and Warehouse modules remain the source of truth.
- No duplicate mapping table is introduced.
- Customized rules are protected from preset overwrite.
- Warehouse UI does not overstate functionality that the stock engine cannot yet guarantee.

Constraint:

- Arus Barang source/destination Warehouse execution stays HOLD until warehouse-scoped inventory exists.
- Cash/Goods approval facts are not journal-posted by this ADR alone.

## Related

- `contracts/accounting-settings-v1.md`
- `contracts/accounting-flow-presets-v1.md`
- `contracts/operational-posting-v1.md`
- `src/accounting-settings.js`
- `src/warehouse-settings.js`

## DOC-IMPACT

REQUIRED — any change to preset direction, counterpart selection, Warehouse routing boundary, or posting activation requires matching contract and tests.
