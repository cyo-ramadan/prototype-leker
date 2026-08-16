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

Current feedback schema gate checks:

- `customer_feedback_reports`
- `customer_feedback_report_issues`

The gate is implemented by `scripts/verify-remote-schema.mjs`. Missing required tables stop deployment before the new Worker is promoted.

## Preview branch rule

Cloudflare non-production branch builds normally use `wrangler versions upload`. Preview uploads do not automatically apply repository D1 migrations.

Therefore a branch preview that introduces a new migration is **code-preview only** until the required remote schema exists or a dedicated preview D1 environment is explicitly provisioned. Do not interpret a successful preview Worker build as proof that production D1 is ready.

For schema-changing work:

- UI/layout can be reviewed on preview;
- DB-backed behavior is not deployment evidence unless the matching schema is known to exist;
- do not manually create ad-hoc production tables just to make a preview work;
- merge through the canonical production road so migration and Worker promotion remain ordered and auditable.

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

This runbook is the canonical operational recovery, bounded execution, and deployment-order reference for Prototype Leker schema-changing releases.
