# Prototype Leker Module Manifest

Status: ACTIVE
Module ID: `PROTOTYPE_LEKER`
Module name: Prototype Leker
Primary owner / final decision maker: Bos Cyo
Repository: `cyo-ramadan/prototype-leker`
Protocol authority: `cyo-ramadan/maxi-protocol`
Protocol baseline: MAXI Engineering Constitution v0.3 ACTIVE
Production branch: `main`

## 1. Purpose and scope

Prototype Leker is the MAXI Leker business application prototype covering customer ordering, staff/cashier operation, store administration, operational transaction facts, product/inventory workflows, local Accounting composition, and integration/reconciliation surfaces.

This repository may host prototype-local implementations of reusable capabilities, but ownership boundaries remain explicit.

## 2. Domain ownership boundaries

### Prototype Leker / POS owns

- customer/order and cashier operational facts;
- SALE, PURCHASE, EXPENSE source facts;
- store-scoped operational UI/API;
- drawer session and transaction lineage;
- application-side adapters into approved module boundaries.

### Accounting owns

- Chart of Accounts maintenance through the Akuntansi workspace/API;
- journal interpretation and posting;
- posted journal immutability, reversal, ledger, and financial reports.

### Setting Akuntansi owns

- active payment-method registry and settlement-account links;
- Jenis Barang to Inventory/HPP/Revenue account mappings;
- transaction categories and ordered journal source rules;
- configuration readiness only.

### Inventory/Costing owns

- stock movements and authoritative stock balances;
- costing, Average Cost, HPP snapshots, and valuation semantics.

PIMASATU is UI/UX-only and owns none of the domains above.

Direct cross-program database writes are prohibited.

## 3. Canonical runtime and data

- Cloudflare account: `Daily Napkin`
- Worker: `prototype-leker-v2`
- Permanent Worker URL: `https://prototype-leker-v2.daily-napkin.workers.dev`
- Dedicated D1: `prototype-leker-db`
- Binding: `DB`
- Migrations: `migrations/`
- Canonical deploy/recovery: `RUNBOOK.md`

`Dwicahya` must not be used for this prototype unless Bos Cyo explicitly changes the environment classification.

## 4. Current-state sources

Until a dedicated `CURRENT_STATE.md` is introduced, current facts are read from:

1. `README.md` for active product/runtime behavior;
2. active sections of `KNOWN_ISSUES.md` for capability state and explicit open items;
3. `KNOWN_PITFALLS.md` for prohibited regressions and recovery lessons;
4. task-relevant contracts, ADRs, source, migrations, and tests.

History belongs in ADR/commit history, not in this manifest.

## 5. Active integration manifest

### Cashier operational fact APIs

- `POST /api/cashier/sales` → SALE
- `POST /api/cashier/purchases` → PURCHASE
- `POST /api/cashier/expenses` → EXPENSE

Cashier facts carry the configured payment-method code and, where applicable, a configured component/rule identity. They do not carry Account IDs or Debit/Credit decisions.

### Accounting configuration API

Canonical contract: `MAXI_ACCOUNTING_SETTINGS_V1`

- `GET /api/admin/settings/accounting`
- payment-method mapping endpoints
- item-category mapping endpoints
- transaction-category endpoints
- journal-rule endpoints

Account creation/maintenance is intentionally rejected from Setting Akuntansi and belongs to Akuntansi.

### Accounting workspace/API

Canonical contract: `MAXI_ACCOUNTING_WORKSPACE_V1`

- account maintenance under `/api/admin/accounting/accounts`
- posted journals under `/api/admin/accounting/journals`
- ledger and reports under `/api/admin/accounting/...`

### POS → Accounting bridge

Canonical contract: `MAXI_ACCOUNTING_POS_BRIDGE_V1`

Flow:

`committed POS fact → bridge resolver → Setting Akuntansi configuration → Accounting posting boundary → posted journal`

Supported fact mapping:

- `SALE` → `sale`
- `PURCHASE` → `purchase_material`
- `EXPENSE` → `operational`

Bridge delivery is post-commit and idempotent by source fact. Missing configuration must produce reconciliation state such as `NEEDS_CONFIGURATION`; it must never guess an account or roll back the already committed operational fact.

## 6. Required configuration for cashier Accounting posting

For the relevant store:

- at least one active payment method must resolve to an active Accounting-owned account;
- exactly one active payment method is the cashier default;
- product kinds used by SALE/PURCHASE must have active item-category mappings for required Inventory/HPP/Revenue accounts;
- `sale`, `purchase_material`, and `operational` transaction categories must be active with the required ordered journal rules;
- Operational must resolve an active Debit component/rule; if more than one applicable component exists, the fact must identify the selected rule.

The bridge reads configuration from Setting Akuntansi at resolution time. POS must not duplicate this mapping.

## 7. Key contracts and ADRs

Task-specific reading is mandatory. Important active references include:

- `contracts/accounting-settings-v1.md`
- `contracts/accounting-workspace-v1.md`
- `contracts/accounting-pos-bridge-v1.md`
- `contracts/cashier-transaction-composition-v1.md`
- `contracts/pimasatu-ui-v1.md`
- ADR-017 Accounting work vs settings ownership
- ADR-018 Accounting composition host and POS bridge
- ADR-019 Accounting precision/system adjustment
- ADR-023 configured cashier payment and cash-flow Accounting
- ADR-027 PIMASATU UI and Master Biaya boundary

## 8. Deployment and migration invariant

Repository-owned deployment is authoritative. For schema-changing releases the canonical road is:

`main → Cloudflare Git Integration → remote D1 migrations → remote schema verification → Worker deploy → canonical Worker check SUCCESS → live validation`

GitHub Actions Cloudflare deployment is secondary/fallback and may require secrets unavailable to the repository. A failure in that fallback lane does not override a successful canonical Cloudflare Workers Git Integration build.

## 9. Testing and completion

Required evidence depends on the task and may include:

- repository syntax/check and regression tests;
- contract/integration tests;
- remote migration/schema evidence for D1 changes;
- canonical Cloudflare Worker build evidence;
- feature-level live API/UI validation;
- reconciliation evidence that bridge delivery and journal references match the committed business facts.

Final status is `PASS`, `FAIL`, or `BLOCKED`. `FAIL`/`BLOCKED` must not be presented as complete.

## DOC-IMPACT

REQUIRED — this manifest is the local routing and ownership entrypoint required by MAXI onboarding. It adds no runtime, API, database, contract, or deployment behavior by itself.
