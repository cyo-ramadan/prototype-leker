# ADR-022 — Transaction Correction Permits and Shared Staff Raport Facts

Status: ACTIVE
Date: 2026-08-13

## Context

Bos Cyo requires Cashier attempts to delete Sale, Purchase, and Operational Expense to require Admin permission and become one input in cashier KPI/Raport. MAXI requires official financial and inventory history to remain auditable; corrections use reversal/adjustment rather than destructive rewrite.

Prototype Leker already has an Approval Queue, Inventory/Costing source of truth, Accounting posting engine, drawer reports, and Portal Staf. These capabilities must be composed rather than duplicated.

## Decision

### Permit extends the existing Approval Queue surface

An additive `approval_permits` table stores transaction-correction authorization because legacy `approval_requests.request_type` is specifically the CASH_FLOW/GOODS_FLOW/ASSET posting envelope. The management UX mounts correction notification/ACC/Reject into the existing Approval Queue area.

### UI Hapus means soft-delete + compensating correction

The original transaction row is retained. ACC records `voided_at`, actor, reason, and permit linkage. Source reports interpret `voided_at IS NULL` as active.

No committed Sale/Purchase/Expense row is hard-deleted. Original posted journals and official historical stock movements are immutable.

### Drawer reconciliation follows the source transaction

Drawer expected cash is derived from active transaction facts. Once an approved CASH correction marks its source inactive, it no longer contributes to expected drawer cash. A new parallel cash ledger is not created for transaction correction.

### Accounting correction reuses the Accounting engine

If the POS bridge already posted the original journal, Accounting posts an exact reversal through `postAccountingJournal` using the original positive scaled amounts with Debit/Credit sides swapped and `reversalOfJournalId` set.

Negative journal-line amounts are prohibited. “Same journal with minus nominal” is represented by equal positive amount + opposite side.

If the source never produced a POSTED journal, no synthetic journal pair is created. Manual reconciliation skips corrected source facts.

### Domain-specific execution

Operational Expense can be corrected directly because it has no inventory quantity effect.

Normal stock Sale correction returns quantity using `SALE_VOID`, values the return from the original exact Sale COGS snapshot, reverses customer points when applicable, then soft-deletes the Sale.

Sale with generated `AUTO_DADAKAN` production remains HOLD until Bos Cyo decides whether correction also reverses production or leaves the produced goods as stock.

Purchase correction is allowed only when itemized snapshots exist and Inventory/Costing proves there is no later stock movement/cost dependency. It restores the pre-purchase cost state and writes `PURCHASE_VOID`. Otherwise it remains explicit HOLD; downstream historical HPP is not rewritten.

### Raport is a read model

Cashier and Admin consume shared Raport facts derived from existing attendance, transaction, correction-permit, and drawer data. No fraud label or opaque score is generated. Score/grade remains `NEEDS_KPI_POLICY` until Bos Cyo defines the policy.

## Consequences

- Cashier cannot unilaterally remove committed operational effects.
- Admin gets auditable ACC/Reject without a second approval app.
- Drawer, Inventory/HPP, and Accounting remain traceable to source facts.
- Posted Accounting history remains immutable and balanced.
- Purchase/Sale corrections fail closed when deterministic reversal cannot be proven.
- One unresolved business case remains isolated: Sale + AUTO_DADAKAN production.
- Raport gets integrity evidence without prematurely accusing fraud.

## Compatibility and recovery

Migration 0027 is additive. Existing transaction IDs, journals, and movement history remain stable. Recovery uses normal D1 backup/Time Travel discipline before production migration. Rolling application code back after migration leaves additive columns/table present but does not destroy prior data.

## DOC-IMPACT

REQUIRED — contract, migration, source executors, Accounting bridge guard, drawer report, Raport docs/tests, Known Issues, and button audit must remain aligned with this decision.
