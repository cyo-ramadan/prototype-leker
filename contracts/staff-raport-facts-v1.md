# Staff Raport Facts Contract v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_STAFF_RAPORT_FACTS_V1`
Owner: Staff performance read model

## Purpose

Expose one shared auditable fact model for cashier-facing Portal Staf and Admin-facing Raport Kasir without duplicating KPI storage or inventing a performance score.

## Current facts

Per cashier and store, the read model reports:

- Sale count and total amount;
- Purchase count and total amount;
- Operational Expense count and total amount;
- transaction correction permit counts: requested, pending, approved, rejected, execution HOLD, executed;
- attendance total/check-in/check-out;
- drawer session total/closed.

These values are derived from existing operational tables. No parallel KPI fact table is introduced.

## Scoring boundary

`score = null` and `grade = null` while policy is undefined.

Stable status: `NEEDS_KPI_POLICY`.

A future KPI policy must explicitly define at minimum:

- measurement period;
- target/normalization rule per metric;
- positive/negative direction;
- weights;
- grade thresholds;
- treatment of rejected vs approved vs HOLD correction permits.

Until then the UI labels assessment inputs `UNCONFIGURED` and presents facts only.

## Surfaces

- Cashier: Portal Staf → Raport / KPI.
- Admin Gerai: Raport Kasir tab using the same server read model.

## DOC-IMPACT

REQUIRED — changes to fact sources, scoring behavior, scope, or staff/admin parity require contract/tests/current-state updates.
