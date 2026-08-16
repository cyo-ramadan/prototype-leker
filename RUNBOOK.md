# Prototype Leker Deployment Runbook

Status: ACTIVE

## Runtime

- GitHub repository: `cyo-ramadan/prototype-leker`
- production branch: `main`
- Cloudflare account: `Daily Napkin`
- Worker: `prototype-leker-v2`
- D1 database: `prototype-leker-db`
- D1 binding: `DB`
- permanent Worker URL: `https://prototype-leker-v2.daily-napkin.workers.dev`

Database Dwicahya is not used for this prototype.

## Canonical production road

A production deployment that contains a D1 schema change must follow this order and must fail closed:

1. merge approved code and migration into `main`;
2. Cloudflare Workers Git Integration starts the production build;
3. run `npm run db:migrations:apply` against remote binding `DB`;
4. run `npm run db:schema:verify` against remote `sqlite_schema`;
5. only when required schema objects are present, run `wrangler deploy`;
6. require GitHub check `Workers Builds: prototype-leker-v2` to finish `SUCCESS`;
7. perform feature-level live validation before declaring deployment PASS.

Repository command `npm run deploy` owns steps 3 through 5. The Cloudflare Workers production Deploy command MUST be `npm run deploy`, not bare `npx wrangler deploy`, whenever repository migrations are part of the release.

Wrangler invocation on this road is explicitly non-interactive (`npx --yes`). The remote schema verification child process has a 120-second timeout. If Wrangler/D1 does not return within that bound, verification fails and Worker promotion stops instead of consuming the full Workers Builds timeout with an indeterminate deployment state.

Current remote schema gate checks required tables:

- `customer_feedback_reports`
- `customer_feedback_report_issues`
- `debugger_audit_log`
- `chart_of_accounts`
- `accounting_journal_headers`
- `accounting_journal_lines`

Accounting reconciliation guard also requires these exact stale names to be absent:

- `accounting_accounts`
- `accounting_dimensions`
- `accounting_opening_balances`
- `accounting_transaction_mappings`

The verifier rejects a second table whose schema defines all five Accounting account types (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`). `chart_of_accounts` must remain the sole canonical account-definition table.

The gate is implemented by `scripts/verify-remote-schema.mjs`. Missing required tables, forbidden orphan tables, or a parallel five-type Chart of Accounts stop deployment before the new Worker is promoted.

## Accounting schema reconciliation — 2026-08-17

Change ID: `LEKER-ACC-SCHEMA-RECON-20260817`.

Migration `0037_accounting_schema_reconciliation.sql` removes four orphan Accounting tables that match unmerged PR #3 commit `65b3faa0b130f9ecbbf21b9a592f9dcf376f8cec`. The migration must only run through the canonical repository deployment road.

### Pre-migration safety

1. capture the D1 Time Travel checkpoint before repository migrations run;
2. do not manually drop any Accounting object in Dashboard/console as a shortcut;
3. migration `0037` inspects `sqlite_schema` and fails before any drop if another table/view/trigger outside the approved cleanup scope still references the orphan namespace;
4. if that guard fails, report `BLOCKED`, inspect the unexpected object, and request a governed decision rather than widening the drop scope silently.

The current repository deploy wrapper captures a D1 Time Travel checkpoint before applying migrations. That checkpoint is the primary rollback anchor for this reconciliation.

### Row backup and drop order

Before a stale table is dropped, migration `0037` copies every source row into timestamped recovery-only tables:

- `accounting_schema_backup_20260817_accounts`
- `accounting_schema_backup_20260817_dimensions`
- `accounting_schema_backup_20260817_opening_balances`
- `accounting_schema_backup_20260817_transaction_mappings`

It records source row counts in `accounting_schema_reconciliation_log` under change ID `LEKER-ACC-SCHEMA-RECON-20260817` and records canonical account ownership as `chart_of_accounts`.

Drop order is child/reference objects first, then the stale account registry:

1. `accounting_opening_balances`;
2. `accounting_transaction_mappings`;
3. `accounting_dimensions`;
4. `accounting_accounts`.

The snapshot tables are recovery evidence only. They are not an alternate COA registry and application code must never query them as runtime Accounting sources.

### Post-migration verification

Before Worker promotion, `npm run db:schema:verify` must prove:

- `chart_of_accounts`, `accounting_journal_headers`, and `accounting_journal_lines` exist;
- all four orphan table names are absent;
- no second five-type Chart-of-Accounts table exists.

After migration, inspect `accounting_schema_reconciliation_log` to capture the backed-up row counts in deployment evidence. A non-zero count is valid because rows were intentionally preserved before drop; it is not permission to reactivate stale tables.

### Rollback / recovery

Primary rollback when deployment validation fails after migration:

1. stop further promotion/writes related to the failed release;
2. use the D1 Time Travel checkpoint captured immediately before migration as the authoritative restore point;
3. verify `PRAGMA foreign_key_check`, canonical Accounting journal reads, and migration/schema state after restore;
4. correct the migration/guard in a new governed changeset before retrying.

Secondary row-level evidence is available in the timestamped snapshot tables. Do not reconstruct and reactivate the stale PR #3 schema from those rows as an ad-hoc fix. If an explicit owner decision requires restoring those objects, create a new versioned recovery migration that defines the exact historical schema and copies from the snapshots, then document why canonical ownership is being temporarily changed.

Full audit provenance is versioned in `ACCOUNTING_SCHEMA_RECONCILIATION_AUDIT_20260817.md`.

## Preview branch rule

Cloudflare non-production branch builds normally use `wrangler versions upload`. Preview uploads do not automatically apply repository D1 migrations.

Therefore a branch preview that introduces a new migration is **code-preview only** until the required remote schema exists or a dedicated preview D1 environment is explicitly provisioned. Do not interpret a successful preview Worker build as proof that production D1 is ready.

For schema-changing work:

- UI/layout can be reviewed on preview;
- DB-backed behavior is not deployment evidence unless the matching schema is known to exist;
- do not manually create ad-hoc production tables just to make a preview work;
- merge through the canonical production road so migration and Worker promotion remain ordered and auditable.

## Debugger Control Plane activation

Debugger is a machine identity, not a human login. The production Worker must receive `DEBUG_SUPERADMIN_TOKEN` as a **secret/environment binding outside the repository**.

Rules:

1. never commit the token to GitHub, migrations, docs, JS assets, or `wrangler.jsonc`;
2. use a high-entropy token of at least 32 characters;
3. send it only as `Authorization: Bearer <token>` to `/api/debug/*`;
4. rotate the Worker secret if exposure is suspected;
5. do not add Debugger recognition to normal Customer/Kasir/Admin/Owner endpoint auth.

After code deployment and secret configuration, live activation validation is:

1. request `/api/debug/me` without token → expect `401 DEBUGGER_AUTH_REQUIRED`;
2. request with invalid token → expect `401 DEBUGGER_AUTH_REQUIRED`;
3. request with valid token → expect principal `debugger`, role `DEBUGGER`, `readOnly: true`;
4. request `/api/debug/health?store=G001` → inspect module results for Customer, Transactions, Inventory, Accounting, and other registered modules;
5. request `/api/debug/audit` → verify the prior authenticated calls are recorded and no Authorization/token value appears in audit rows.

Worker deployment may succeed while the secret is absent; in that state `/api/debug/*` returns `503 DEBUGGER_NOT_CONFIGURED`, and Debugger activation remains **BLOCKED**, not PASS.

Debugger V1 is diagnostic read-only. Do not add generic SQL execution, arbitrary impersonation, or universal auth bypass. Future write/E2E probes require explicit module contract, debug fixtures/markers, cleanup/idempotency rules, and audit.

## Customer Feedback incident guard

Symptom:

- customer opens **Kotak Saran**;
- UI shows `Belum bisa membuka kotak saran` and generic server error;
- code references `customer_feedback_reports` but remote D1 has not applied `0033_customer_feedback.sql`.

Recovery:

1. confirm the feature migration exists in the target commit;
2. run canonical remote migrations, never rewrite an already-applied historical migration;
3. run `npm run db:schema:verify`;
4. deploy Worker only after schema verification succeeds;
5. validate Customer Feedback access with an authenticated prototype customer;
6. validate Admin/Owner feedback list read path;
7. record deployment evidence in the handover.

If remote migration state disagrees with actual `sqlite_schema`, follow D1 schema-drift recovery discipline: inspect migration state and real schema, capture a Time Travel checkpoint/approved backup when repair is required, restore only authoritative missing objects, then resume canonical migrations.

## Hung or excessively long canonical build

If a schema-changing build remains active abnormally long:

1. do not bypass the gate by manually creating production tables from application code;
2. confirm `npm run deploy` uses explicit non-interactive Wrangler calls;
3. keep the schema verifier bounded so a stalled D1/CLI probe fails before Worker promotion;
4. inspect the final canonical Worker Build conclusion and available build logs/evidence;
5. fix the exact blocked stage, rerun through `main`, and require the full migration → schema verify → deploy sequence again.

Cloudflare platform timeout must not be used as the normal timeout mechanism for an internal schema probe.

## GitHub Actions fallback

The repository also contains a GitHub Actions deployment path. It may require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. That workflow is secondary to the connected Cloudflare Workers Git Integration.

A fallback credential failure does not by itself mean the canonical Cloudflare Git deployment failed. Production PASS is based on the canonical Worker build plus schema and live validation evidence.

## Deployment completion checklist

A schema-changing deployment is PASS only when all applicable items are true:

- repository quality tests pass;
- migration is committed with the feature;
- remote migration command succeeds;
- remote schema verification succeeds;
- Worker deployment succeeds;
- canonical `Workers Builds: prototype-leker-v2` check is `SUCCESS`;
- affected live API/UI flow is validated;
- documentation/contract reflects the deployed behavior;
- no unresolved migration, compatibility, or rollback risk remains.

If any required item is missing, report `BLOCKED` or `FAIL`, never `PASS`.

## DOC-IMPACT

This runbook is the canonical operational recovery, bounded execution, deployment-order, Accounting schema-reconciliation, and Debugger activation reference for Prototype Leker.
