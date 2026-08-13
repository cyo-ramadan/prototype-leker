# Accounting Cash Flow Bridge v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1`
Owner: Accounting integration boundary

## Purpose

Post an already-approved and already-posted cashier `CASH_FLOW` business fact into the same Accounting journal engine used by other system journals, without moving operational approval ownership into Accounting.

Flow:

`Cashier request -> Approval Queue -> operational cash ledger commit -> Accounting cash-flow bridge -> Setting Akuntansi resolver -> Accounting journal engine`

## Source Fact

The bridge consumes only an operational fact that is already authoritative:

- `approval_requests.request_type = CASH_FLOW`;
- `approval_status = approved`;
- `posting_status = posted`;
- a matching `cash_ledger_entries` row exists for the same store and approval request.

Accounting delivery must never make the operational ACC transactional with Accounting. The operational commit happens first.

## Direction Mapping

- operational `IN` resolves transaction category `cash_flow_in`;
- operational `OUT` resolves transaction category `cash_flow_out`.

The category/rules are read from the existing Accounting Settings registries. No cash-flow account mapping table is introduced.

## Rule Shape

V1 requires exactly two active rules for the selected cash-flow category:

1. one `payment_method` rule;
2. one `fixed_account` rule;
3. one rule is `DEBIT` and one rule is `CREDIT`.

A customized or incomplete active shape fails closed as `NEEDS_CONFIGURATION` rather than being guessed.

## Settlement Method

Operational Cash Flow changes the physical drawer, so V1 resolves the configured active payment method with code `CASH`.

`CASH` must point to an active Accounting-owned account. Missing settlement/account mapping fails closed.

The operational producer carries no Account ID and no Debit/Credit posting decision.

## Amount Precision

Operational Cash Flow amount is whole-rupiah integer input. Accounting converts it exactly to the canonical journal scale:

`amountScaled = amountRupiah * 1,000,000`

No binary `REAL/FLOAT` amount is introduced.

## Journal Posting

The bridge calls the canonical `postAccountingJournal()` entry point.

Journal identity:

- `sourceSystem = LEKER_POS`;
- `sourceReferenceId = CASH_FLOW:<approvalRequestId>`;
- `correlationId = <approvalRequestId>`;
- `idempotencyKey = LEKER_POS:CASH_FLOW:<approvalRequestId>`.

Posted Accounting journals remain immutable under the Accounting contract.

## Post-Commit Safety

If Accounting is unavailable or configuration is incomplete after the operational ACC:

- the approved cash movement remains committed;
- drawer facts remain authoritative;
- Accounting delivery records `NEEDS_CONFIGURATION` or `FAILED`;
- no second operational Cash Flow fact is created;
- retry uses the same source fact and idempotency identity.

The management retry route is:

`POST /api/management/approval-requests/:id/accounting-sync`

It is valid only for an approved + posted `CASH_FLOW` request within the caller's management scope.

## Delivery State

The bridge reuses `accounting_bridge_deliveries` as reconciliation state:

- `producer_module = POS`;
- `fact_type = CASH_FLOW`;
- `fact_id = approvalRequestId`;
- transaction category code;
- status;
- journal reference when posted;
- failure code/detail;
- attempts/timestamps.

This table is not a mapping registry.

## Fail-Closed Examples

- missing `cash_flow_in` / `cash_flow_out` category -> `NEEDS_TRANSACTION_MAPPING`;
- invalid rule shape -> `NEEDS_MAPPING`;
- CASH account missing/inactive -> `NEEDS_PAYMENT_MAPPING`;
- fixed counterpart missing/inactive -> `NEEDS_FIXED_ACCOUNT`;
- invalid amount/date -> `FAILED` integrity status.

## Explicitly Out of Scope

`GOODS_FLOW` is not posted by this bridge.

Generic goods movement requires exact Inventory/Costing valuation plus the unresolved Warehouse routing contract. Quantity alone must not be converted into an Accounting amount by guessing current mutable HPP.

Returns are also outside this contract until Supplier Return / Customer Return / internal-return taxonomy is approved.

## Implementation

- `src/accounting-cash-flow-bridge.js`
- `src/approval-queue.js`
- `contracts/accounting-flow-presets-v1.md`
- `test/accounting-cash-flow-bridge.test.js`

## DOC-IMPACT

REQUIRED — changes to direction mapping, settlement method, rule shape, source-fact authority, precision, retry/idempotency, delivery state, or post-commit safety require matching contract/ADR/tests.
