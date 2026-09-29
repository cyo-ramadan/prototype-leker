# Transaction Correction Permit Contract v1

Status: ACTIVE, DEPLOYED (migration `0027` applied to production 2026-08-13)
Contract identifier: `MAXI_TRANSACTION_VOID_PERMIT_V1`
Owner: Approval authorization + transaction-owner correction executor + Accounting reversal engine

## Purpose

Cashier-originated requests to remove the operational effect of an existing Sale, Purchase, or Operational Expense require explicit Admin/Owner authorization and an auditable lifecycle.

The cashier UI may say **Hapus**. Backend semantics are **soft-delete + compensating correction**. Original transaction rows, posted journals, and historical stock movements are never physically deleted or rewritten.

## Approval bridge

This capability reuses the existing management Approval Queue surface and authorization model. It stores the transaction-specific authorization envelope in additive `approval_permits` because legacy `approval_requests.request_type` is reserved for CASH_FLOW/GOODS_FLOW/ASSET posting envelopes.

Cashier may request only an active transaction belonging to the authenticated cashier, current store, and currently owned drawer. The server snapshots transaction identity, amount, payment method, description, and relevant references. A human-readable reason is mandatory. Only one unresolved permit may exist for the same store + subject type + subject ID.

Before ACC, the source transaction remains active and continues affecting drawer, inventory/HPP, and Accounting.

The requesting cashier/CS may withdraw its own still-`pending_approval` request (`DELETE /api/cashier/transaction-void/permits/:id`). Withdrawal reuses the `rejected` state (`approved_by_role = 'CASHIER_SELF'`) rather than introducing a new status value, so the one-unresolved-permit-per-subject guard and the existing Admin lifecycle stay unchanged; the Admin panel and cashier UI distinguish it from an Admin rejection by that role.

The cashier-facing entry point lives inline in the "Data Transaksi" row (kasir · Data · tab Transaksi), next to Detail, for SALE/PURCHASE/EXPENSE rows only -- not a separate standalone button. While a request is `pending_approval` the row shows a "Read only (request delete)" note and the action flips from Hapus to Batal Hapus.

## Management decision

Admin Gerai may decide only permits in its store. Owner may decide an explicitly selected authorized store. Legacy PIN authorization is not accepted.

`REJECT` closes the permit without operational mutation.

`ACC` records authorization and invokes the transaction-owner correction executor. ACC never performs hard SQL deletion.

Execution states are `NOT_ATTEMPTED`, `HOLD`, `EXECUTED`, and `FAILED`. HOLD is visible and must never be reported as successful removal.

The ACC-then-execute flow is two sequential writes (approve, then execute-and-finalize), not one atomic batch. A client disconnect between them leaves a permit stuck at `approved`/`NOT_ATTEMPTED` with empty execution code/detail forever — observed in production on 6 permits requested 2026-09-01/04. Because the operational correction and the Accounting reversal are both self-idempotent (the `voided_at IS NULL` guard, the reversal's `idempotencyKey`), Admin/Owner may re-run only the execute-and-finalize half via `decision: 'RETRY_EXECUTION'` on any permit at `approved` + execution status other than `EXECUTED`, without re-deciding or double-applying anything.

## Source soft-delete state

Migration `0027_transaction_void_permits.sql` adds `voided_at`, `voided_by_role`, `voided_by_id`, `void_reason`, and `void_permit_id` to `sales`, `purchases`, and `expenses`.

`voided_at IS NULL` means operationally active. Corrected rows remain queryable as audit history.

Drawer reporting and Accounting reconciliation use active source facts. Therefore an approved correction of a CASH transaction no longer contributes to current expected drawer cash while the original source row remains auditable.

## Executor semantics

### EXPENSE

Operational Expense correction is active. ACC marks the source soft-deleted. If a POSTED Accounting journal exists, Accounting posts an exact reversal. If no original journal was POSTED, Accounting status is `NOT_REQUIRED` and future manual reconciliation must skip the corrected fact. Expense quantity remains behavioural metadata and never becomes an inventory movement.

### SALE — normal stock sale

ACC preserves the original Sale and SALE stock movements, uses original `sale_items.line_cogs` exact scaled snapshots, returns sold quantities through new `SALE_VOID` stock movements, incorporates returned stock into current moving-average cost using historical exact COGS rather than current Product Master HPP, reverses earned customer points when applicable, marks the Sale soft-deleted, and reverses the original posted Accounting journal when one exists.

Missing/invalid Sale cost snapshot fails closed with `SALE_COST_SNAPSHOT_REQUIRED`.

### SALE — AUTO_DADAKAN

Decided by Bos Cyo 2026-09-24: correcting the Sale reverses its generated production run as an exact mirror ("yang + diganti minus dan yang minus diganti +"). In the same atomic batch as the normal Sale correction above:

- every recorded `PRODUCTION_OUTPUT` movement is pulled back with a `PRODUCTION_VOID` OUT movement and its value (`production_runs.hpp_total_scaled`) removed from moving-average cost;
- every recorded `PRODUCTION_INPUT` movement is returned with a `PRODUCTION_VOID` IN movement valued at its `production_run_components.total_cost_snapshot_scaled`;
- the production run is marked `CANCELLED` (drawer report already counts only `POSTED`; Transaction Explorer shows the status);
- only movements that were actually recorded are mirrored (untracked goods have none); original movements are never edited.

AUTO_DADAKAN production posts no Accounting journal of its own (verified on production D1: 643 runs, 0 deliveries), so the Sale journal reversal is the only Accounting reversal.

Precondition enforced upstream: a recipe can be linked for Dadakan only when its output quantity is 1 (`resolveLinkedRecipe`, `DADAKAN_RECIPE_OUTPUT_MUST_BE_ONE`), and a legacy link to a larger-output recipe cannot sell Dadakan. So produced quantity always equals sold quantity and no leftover batch can have been consumed by another transaction.

Remaining HOLD codes (fail closed, no mutation): `SALE_AUTO_PRODUCTION_EXCESS_OUTPUT` (legacy run where output ≠ sold quantity), `SALE_AUTO_PRODUCTION_STATE_INVALID`, `PRODUCTION_COST_SNAPSHOT_REQUIRED`, `PRODUCTION_MOVEMENT_INVALID`.

If the goods were physically made and discarded, that consumption is recorded separately through audited Stock Adjustment.

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
