# Transaction Correction Permit Contract v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_TRANSACTION_VOID_PERMIT_V1`
Owner: Approval authorization + transaction-owner correction executor + Accounting reversal engine

## Purpose

Cashier-originated requests to remove the operational effect of an existing Sale, Purchase, or Operational Expense require explicit Admin/Owner authorization and an auditable lifecycle.

The cashier UI may say **Hapus**. Backend semantics are **soft-delete + compensating correction**. Original transaction rows, posted journals, and historical stock movements are never physically deleted or rewritten.

## Approval bridge

This capability reuses the existing management Approval Queue surface and authorization model. It stores the transaction-specific authorization envelope in additive `approval_permits` because legacy `approval_requests.request_type` is reserved for CASH_FLOW/GOODS_FLOW/ASSET posting envelopes.

Cashier may request only an active transaction belonging to the authenticated cashier, current store, and currently owned drawer. The server snapshots transaction identity, amount, payment method, description, and relevant references. A human-readable reason is mandatory. Only one unresolved permit may exist for the same store + subject type + subject ID.

Before ACC, the source transaction remains active and continues affecting drawer, inventory/HPP, and Accounting.

## Management decision

Admin Gerai may decide only permits in its store. Owner may decide an explicitly selected authorized store. Legacy PIN authorization is not accepted.

`REJECT` closes the permit without operational mutation.

`ACC` records authorization and invokes the transaction-owner correction executor. ACC never performs hard SQL deletion.

Execution states are `NOT_ATTEMPTED`, `HOLD`, `EXECUTED`, and `FAILED`. HOLD is visible and must never be reported as successful removal.

## Source soft-delete state

Migration `0027_transaction_void_permits.sql` adds `voided_at`, `voided_by_role`, `voided_by_id`, `void_reason`, and `void_permit_id` to `sales`, `purchases`, and `expenses`.

`voided_at IS NULL` means operationally active. Corrected rows remain queryable as audit history.

Drawer reporting and Accounting reconciliation use active source facts. Therefore an approved correction of a CASH transaction no longer contributes to current expected drawer cash while the original source row remains auditable.

## Executor semantics

### EXPENSE

Operational Expense correction is active. ACC marks the source soft-deleted. If a POSTED Accounting journal exists, Accounting posts an exact reversal. If no original journal was POSTED, Accounting status is `NOT_REQUIRED` and future manual reconciliation must skip the corrected fact. Expense quantity remains behavioural metadata and never becomes an inventory movement.

### SALE — normal stock sale

Correction is active when the Sale did not create `AUTO_DADAKAN` production.

ACC preserves the original Sale and SALE stock movements, uses original `sale_items.line_cogs` exact scaled snapshots, returns sold quantities through new `SALE_VOID` stock movements, incorporates returned stock into current moving-average cost using historical exact COGS rather than current Product Master HPP, reverses earned customer points when applicable, marks the Sale soft-deleted, and reverses the original posted Accounting journal when one exists.

Missing/invalid Sale cost snapshot fails closed with `SALE_COST_SNAPSHOT_REQUIRED`.

### SALE — AUTO_DADAKAN

Execution is **HOLD** with `SALE_AUTO_PRODUCTION_CORRECTION_POLICY_REQUIRED`.

The unresolved business decision is whether correcting the Sale also reverses its generated production run or leaves the produced goods as stock. Until Bos Cyo defines that meaning, the system must not guess or partially mutate the Sale.

### PURCHASE

Purchase correction is active only when Inventory/Costing can prove the historical purchase is reversible without rewriting later history.

Required guards:

- itemized `purchase_items` snapshots exist;
- current stock still covers the purchased quantity;
- current Average Cost still matches the purchase `average_cost_after` snapshot;
- no later stock movement exists for the affected product after that purchase.

When safe, ACC atomically writes `PURCHASE_VOID` stock-out movements, reduces stock by the original purchase quantity, restores `average_cost_before`, restores prior Last Purchase Price evidence from the latest earlier non-corrected purchase when available, marks the Purchase soft-deleted, and reverses the original Accounting journal when one exists.

Later stock/cost history causes explicit HOLD such as `PURCHASE_DOWNSTREAM_STOCK_EXISTS`; downstream historical HPP is never recomputed or rewritten.

## Accounting reversal

Posted Accounting history is immutable. A correction never creates negative journal-line amounts.

For a POSTED original journal, the reversal uses the same positive exact `amountScaled` on each line and swaps the side: `DEBIT` becomes `CREDIT`, `CREDIT` becomes `DEBIT`. It records `reversalOfJournalId = original.journalId` and an idempotency key derived from the permit.

This has the same financial effect as “the original journal with minus nominal” while preserving the Accounting invariant that amount is positive and Debit/Credit is represented by side.

The reversal is effective at correction/ACC time. The original journal remains at original transaction time, preserving chronology.

If no POSTED original exists, no synthetic original journal is created. The correction records `NOT_REQUIRED`, and reconciliation skips the soft-deleted fact.

## Raport / KPI relationship

Permit requests, approvals, rejections, execution results, amount/payment method, timing, and drawer discrepancy are auditable staff-integrity facts exposed through the shared Raport read model.

This contract does not label fraud and does not assign score/grade. KPI weight, target, direction, period, and grade thresholds remain `NEEDS_KPI_POLICY` until Bos Cyo defines them.

## Compatibility

- additive migration; IDs and historical rows remain stable;
- existing Approval Queue remains the management surface;
- no second Accounting engine, drawer ledger, Inventory source, or KPI database is introduced;
- corrected transactions remain available for audit/history;
- unsupported semantics fail closed per transaction while unrelated flows continue working.

## DOC-IMPACT

REQUIRED — changes to authority, soft-delete state, Inventory/HPP correction semantics, Accounting reversal, Raport fact exposure, or HOLD policy require matching contract, ADR, tests, Known Issues/Current State, and button-audit updates.
