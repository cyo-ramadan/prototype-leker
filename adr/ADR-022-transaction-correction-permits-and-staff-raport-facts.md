# ADR-022 — Transaction Correction Permits and Shared Staff Raport Facts

Status: ACTIVE
Date: 2026-08-13

## Context

Bos Cyo requires Sale, Purchase, and Operational Expense deletion attempts from Cashier to require Admin permission and to become one input in cashier KPI/Raport. Existing MAXI rules require posted financial/inventory history to remain auditable and corrections to use reversal/adjustment rather than destructive rewrite.

Prototype Leker already has an Approval Queue for cashier-originated operational postings and a Portal Staf for employee-facing data. Those capabilities should be reused rather than replaced.

## Decision

### Permit is an Approval Queue extension

An additive `approval_permits` table stores transaction correction authorization requests. The existing `approval_requests` table is not overloaded because its request type CHECK constraint represents CASH_FLOW/GOODS_FLOW/ASSET posting envelopes and a transaction correction must not pretend to be one of those facts.

The management UI mounts the permit queue inside the existing Approval Queue surface.

### Delete means void/reversal intent

The cashier UI may say Hapus because that is the operator intent. Backend semantics preserve original transaction rows as audit history. Admin ACC authorizes a domain-owned correction executor; it does not run a hard SQL delete.

### Fail closed when reversal meaning is incomplete

SALE and PURCHASE remain execution HOLD after ACC because their downstream stock/cost/points/production/Accounting effects cannot be safely guessed.

EXPENSE also remains HOLD in this version until an auditable operational status and Accounting reversal executor are composed.

Each HOLD carries a stable execution code and human-readable detail. The UI must not report the transaction as removed.

### Raport is a read model, not a second source of truth

Cashier and Admin surfaces both consume `MAXI_STAFF_RAPORT_FACTS_V1`, derived from existing transaction, permit, attendance, and drawer tables.

No score or grade is generated until KPI policy explicitly defines period, weights, targets, direction, and grade thresholds.

## Consequences

- Admin receives a real notification/decision surface without creating a second approval app.
- Correction attempts become auditable KPI facts immediately.
- Historical operational/Accounting/Inventory facts are not silently destroyed.
- Unsupported reversal cases remain visibly HOLD while unrelated features continue working.
- Later executor contracts can attach to approved permits without redesigning the request UX.

## DOC-IMPACT

REQUIRED — changes to permit authority, correction semantics, executor status, Raport fact sources, or scoring activation require matching contracts/tests/current-state docs.
