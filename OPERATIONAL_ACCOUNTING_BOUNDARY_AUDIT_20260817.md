# Operasional Accounting Boundary Audit — 2026-08-17

Change ID: `LEKER-OPS-ACC-BOUNDARY-20260817`
Protocol: MAXI AI Engineering Constitution v0.3, MAXI Integration Contract Standard v0.3, MAXI Mandatory Transaction Registration Protocol v0.1
Repository baseline audited: `cyo-ramadan/prototype-leker@6d6eab52e1d3bbd5f00239036a9dac34948fbe91`
Baseline quality gate: `Check & Test` re-run SUCCESS before implementation; secondary deploy lane stopped at credential validation before deployment mutation.

## Audit question

Audit every read/write/population/consumption of `expenses.accounting_component_rule_id`, determine whether Operasional posts Accounting journals directly, and decide whether the change can proceed without changing posting semantics.

## Findings

### Schema provenance

Migration `0025_accounting_pos_bridge.sql` added:

`expenses.accounting_component_rule_id TEXT REFERENCES journal_rules(id) ON DELETE RESTRICT`

It also added an index and a scope trigger requiring the selected rule to be an active fixed-account Debit rule under transaction category `operational`.

Migration `0034_cost_master.sql` introduced the same cross-domain reference in `cost_types.accounting_component_rule_id`. Migration `0035_operational_cost_accounting_defaults.sql` populated Cost Types from the active Operational Debit rule.

### Write paths

`src/cashier-operational-expense.js` had two write paths:

1. Cost Master batch flow joined `cost_types` and copied `ct.accounting_component_rule_id` into every new `expenses` row.
2. Legacy single-expense flow accepted `accountingComponentRuleId` from the request, validated it against `listOperationalAccountingComponents()`, then persisted it.

### Read/UI paths

- `src/cost-master.js` joined `cost_types` directly to `journal_rules` and returned `accountingComponentRuleId` / `accountingComponentLabel`.
- `public/admin-cost-master.js` described Jenis Biaya as linked to an Accounting Debit component and displayed that label.
- `src/cashier-workspace.js` loaded `listOperationalAccountingComponents()` and exposed the result as `operationalAccountingComponents`.
- `public/cashier-workspace.js` stored the same Accounting component list in cashier state.

Current canonical PIMASATU Operasional entry itself did not contain a journal-rule selector; it selected Cost Master rows and payment method.

### Downstream consumption

`src/accounting-pos-bridge.js` loaded `expenses.accounting_component_rule_id` into the EXPENSE fact. For fixed-account Operational Debit rules it used the stored id, when present, to identify the selected rule. The Bridge then resolved the Accounting-owned fixed account and called the Accounting posting entry point.

No Operasional handler/service inserted `accounting_journal_headers` or `accounting_journal_lines` directly and no Operasional code called `postAccountingJournal()` directly.

## Decision gate

**Outcome: SAFE PATH, not Constitution R2 stop.**

The field was used downstream, so it was not dead. However it was consumed inside the existing Accounting POS Bridge and did not cause Operasional to post journals directly. Therefore step 2b did not apply and posting behavior did not require Bos Cyo authorization to be rerouted.

The safe change is to remove Operasional ownership of Accounting rule identity while keeping the same shared post-commit Bridge.

## Integration-outbox discrepancy

The requested change text described `integration_outbox` as the current SALE/PURCHASE pattern. Audit of current `main` found a different canonical implementation:

- `src/index.js` sends committed SALE, PURCHASE, and EXPENSE responses through `attachAccountingBridgeToCommittedResponse()`;
- `src/accounting-pos-bridge-response.js` invokes the shared Accounting POS Bridge after the business fact commits;
- `accounting_bridge_deliveries` stores delivery/reconciliation state;
- current `main` has no active `integration_outbox` implementation.

An `integration_outbox` implementation exists only in stale overlapping PR #3 referenced by the 2026-08-13 handoff. Reintroducing it in this change would create a second integration architecture and widen scope beyond the boundary repair.

Therefore this changeset preserves the current canonical lane:

`committed business fact -> shared post-commit Accounting Bridge -> Setting Akuntansi resolver -> Accounting posting entry point`

## Additional boundary finding

Removing only the FK on `expenses` would leave the same violation upstream in `cost_types`. The changeset therefore also removes the `cost_types -> journal_rules` FK and removes runtime/UI use of that field as Accounting authority. Historical values are preserved only for rollback evidence.

## Transaction registration

`TRANSACTION_POTENTIAL: YES` because EXPENSE moves money.

No new transaction type or subtype is introduced. Existing registered business event `EXPENSE` and transaction category `operational` remain unchanged. No new Accounting mapping or journal semantics are created.

## DOC-IMPACT

**REQUIRED** — changes how Operasional reports transactions to Accounting; removes a direct cross-module schema reference.
