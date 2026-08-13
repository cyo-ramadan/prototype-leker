# Transaction Correction Permit Contract v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_TRANSACTION_VOID_PERMIT_V1`
Owner: Approval authorization + domain-owned correction executors

## Purpose

Cashier-originated requests to remove the operational effect of an existing Sale, Purchase, or Expense require explicit Admin/Owner authorization and an audit trail.

The word delete in the UI means a business correction request. Canonical transaction history is not hard-deleted.

## Approval bridge

This capability reuses the existing management Approval Queue UI and authorization model. It uses an additive `approval_permits` table because the legacy `approval_requests.request_type` CHECK enum is limited to operational posting types and must not be mislabelled.

Cashier may request only for a transaction belonging to the cashier, current store, and currently owned drawer. The server snapshots the transaction identity, amount, payment method, description, and relevant references at request time. A human-readable reason is required.

Only one pending permit may exist per store + transaction type + transaction ID.

## Management decision

Admin Gerai may decide permits only in its own store. Owner may decide across authorized store scope. Legacy PIN authorization is not accepted.

REJECT closes the permit without operational mutation.

ACC records authorization. It does not authorize destructive SQL deletion.

## Executor boundary

### SALE

Execution status remains HOLD with `SALE_REVERSAL_CONTRACT_REQUIRED` until one deterministic contract defines reversal of all applicable facts: inventory movements, COGS snapshots, customer points, linked order state, production/AUTO_DADAKAN lineage, and posted Accounting journal.

### PURCHASE

Execution status remains HOLD with `PURCHASE_COST_REVERSAL_CONTRACT_REQUIRED` until moving-average HPP and later dependent stock/cost history can be corrected deterministically without rewriting historical snapshots.

### EXPENSE

Execution status remains HOLD with `EXPENSE_REVERSAL_EXECUTOR_PENDING` until an auditable operational status plus Accounting reversal executor is active.

A HOLD is visible state, not silent success.

## KPI / Raport relationship

Permit request and decision counts are auditable staff-performance facts. This contract does not assign score or punishment. KPI weights and interpretation belong to a separate policy.

## DOC-IMPACT

REQUIRED — changes to scope, snapshot facts, authority, execution semantics, or KPI exposure require contract/tests/current-state updates.
