# ADR-019 — Six-Decimal Accounting Precision and System Adjustment

Status: ACTIVE
Date: 2026-08-13

## Context

Prototype Leker already stores authoritative Average Cost, purchase unit cost, production HPP, and sale COGS using exact scaled INTEGER values where `1 rupiah = 1,000,000 cost units`.

The first Accounting Workspace version stored journal amounts as whole-rupiah INTEGER values. That created an unresolved boundary for sale HPP when the exact COGS contained fractional rupiah.

Bos Cyo approved these business policies:

1. HPP/accounting precision is capped at 6 decimal places per rupiah.
2. Digits beyond 6 decimals are rounded at the next digit.
3. A system-generated journal may be auto-balanced when the remaining Debit/Credit difference is at most Rp100.
4. The balancing row is named `Penyesuaian` and uses a dedicated Equity account rather than modifying the owner's primary Modal account.
5. Negative account balances are allowed. Journal balance, not positivity of each account balance, is the integrity gate.
6. Manual journals must still balance exactly and must not receive an automatic tolerance adjustment.

## Decision

### Exact journal scale

Accounting journal amounts use exact scaled INTEGER representation:

`1 rupiah = 1,000,000 accounting units`

The authoritative SQL column is `accounting_journal_lines.amount_scaled INTEGER`.

Existing whole-rupiah journal history is migrated exactly by multiplying the old `amount_minor` value by `1,000,000`.

No new Accounting source of truth may use binary REAL/FLOAT.

### Rounding

An exact decimal input may contain more than 6 fractional digits at an adapter boundary.

Accounting rounds **half-up** at digit 7:

- seventh digit `0..4` -> retain six digits;
- seventh digit `5..9` -> add one scaled unit.

After this normalization, Accounting operates only on scaled integers.

### Journal line versus account balance sign

Posted journal line amounts are positive values plus an explicit `DEBIT`/`CREDIT` side.

Derived account balances may be positive, zero, or negative. Negative balances are preserved in General Ledger and financial-report read models and must not be converted through `abs()` merely for display convenience.

### System balancing tolerance

A non-manual Accounting command may explicitly request policy:

`AUTO_EQUITY_UP_TO_100_RUPIAH`

Accounting then computes the exact difference between total Debit and Credit after all resolved business lines.

- difference = 0 -> post normally;
- absolute difference <= `100,000,000` scaled units (`Rp100.000000`) -> add one system-generated line to the side that is short;
- difference > `100,000,000` scaled units -> reject posting.

The generated line:

- uses dedicated account `Penyesuaian`;
- account type `EQUITY`;
- subtype `ROUNDING_ADJUSTMENT`;
- reserved account code `SYS-ADJ` per store;
- description `Penyesuaian`;
- `is_system_generated = 1`.

The account is Accounting-owned and user maintenance is blocked.

### Manual journals

Manual journals do not use tolerance. Total Debit and Credit must match exactly after six-decimal normalization.

### Sale HPP bridge

Sale HPP snapshots already use the same `1e6` scale. The POS Accounting bridge therefore passes the snapshotted sale `lineCogsScaled` directly for:

- Debit HPP (`item_category_cogs`);
- Credit Persediaan (`item_category_inventory`).

It must not recompute HPP from current Product Master cost.

The former `NEEDS_COST_ROUNDING_POLICY` blocker is resolved by this ADR.

## Ownership Boundary

This decision does not move stock or costing ownership into Accounting.

- Inventory/Costing owns stock balance and HPP calculation/snapshots.
- Accounting owns journal precision, balancing, ledger, and reports.
- Integration Bridge transports/resolves approved facts and does not directly insert journal rows.

Store-level operational policies that protect HPP integrity, such as optionally blocking a purchase while the current inventory balance is negative, belong to Inventory/Costing even if surfaced through a shared Settings UI.

## Consequences

Positive:

- HPP journals no longer lose fractional rupiah precision;
- sale COGS and inventory reduction can post from the same historical snapshot;
- manual and system journals still share one exact ledger;
- report balances can truthfully show negative account balances;
- small system integration differences have an explicit, auditable tolerance policy;
- larger differences remain fail-closed.

Costs/constraints:

- journal storage migration rebuilds the journal-line table;
- API/read models must carry scaled/exact fields while maintaining temporary whole-rupiah compatibility projections;
- six-decimal scaled INTEGER limits the maximum safe per-line value for JavaScript adapters and therefore requires safe-integer guards;
- `Penyesuaian` becomes an explicit Equity balance and must remain visible/auditable in financial statements.

## Rejected Alternatives

### Round HPP to whole rupiah before Accounting

Rejected because it discards approved six-decimal costing precision and creates cumulative reconciliation differences.

### Carry fractional residuals between transactions

Rejected because a common exact six-decimal scale is simpler and avoids cross-transaction residual state.

### Use the primary Modal account as the automatic plug account

Rejected because system precision differences should not mutate the semantic history of owner capital contributions.

### Auto-adjust manual journals

Rejected because the tolerance would hide operator entry mistakes.

### Force all account balances non-negative

Rejected because a negative account balance can be a legitimate/accounting-significant state. Integrity is enforced at balanced journal-entry level.

## Related

- ADR-015 — Product Master and exact costing
- ADR-018 — Accounting Composition Host and POS Bridge
- `contracts/accounting-workspace-v1.md`
- `contracts/accounting-pos-bridge-v1.md`
- `migrations/0026_accounting_six_decimal_precision.sql`
- `src/accounting-ledger.js`
- `src/accounting-pos-bridge.js`

## DOC-IMPACT

REQUIRED — changes to precision scale, rounding, tolerance, adjustment account semantics, or negative-balance representation require a new/superseding decision record plus matching contract and regression changes.
