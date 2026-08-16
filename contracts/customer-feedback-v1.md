# Customer Feedback Contract V1

Status: ACTIVE for Prototype Leker

## Purpose

Customer Feedback V1 adds a private, structured **Kotak Saran** for authenticated customers. Reports are persisted as first-class business facts so Admin Gerai, Owner, and a future Owner AI assistant can evaluate recurring quality signals without depending on free-form chat history.

## Customer-facing behavior

1. The customer page exposes **Kotak Saran**. After the public feedback catalog loads, the category buttons are rendered immediately. Category visibility must not depend on customer login state or submission entitlement.
2. The customer selects exactly one category:
   - `PRODUCT_QUALITY` / Mutu Produk;
   - `SERVICE` / Pelayanan;
   - `CLEANLINESS` / Kebersihan.
3. Each category offers stable issue codes with customer-readable labels. Multiple issues may be selected.
4. A manual note is available for feedback outside the predefined list.
5. A report must contain at least one selected issue or a non-empty manual note.
6. The page states that reporter privacy is protected, reports are for management evaluation, and reporter identity is not shared to cashier/customer-service staff through this feature.
7. An accepted report earns the explicit Customer Feedback V1 reward of **500 points**. This reward is isolated to this contract and does not define a global point redemption value or generic sale earning ratio.
8. Customer UI receives only whether submission is currently available. Entitlement controls whether **Laporkan** can execute, not whether the category catalog is visible. The UI must not publish quota thresholds, cooldown rules, internal entitlement type, or entitlement keys.

## Submission entitlement

Submission entitlement is enforced only on the server.

- A qualifying sale is a non-voided sale for the selected store, attributed to the authenticated customer, with `total_amount >= 50000`.
- A qualifying sale that occurred after the customer's latest feedback can unlock one new submission.
- If no such sale unlock is available, a customer may submit when they have not submitted another feedback report in the current Asia/Jakarta business month.
- The server stores an internal unique entitlement key and, for sale-backed submissions, the qualifying `sale_id`.
- Concurrency must fail closed. The same monthly entitlement or qualifying sale cannot create two reports.

These rules are intentionally internal and are not rendered in customer-facing copy.

## Persistence

Migration `0033_customer_feedback.sql` owns:

- `customer_feedback_reports` for report header, category, manual note, entitlement audit, reward snapshot, store/customer references, and timestamp;
- `customer_feedback_report_issues` for normalized issue-code rows plus immutable label snapshots.

Normalized issue rows are the reporting source for weekly aggregation and future AI analysis. Customer feedback must not be written into `orders`, `sales.note`, customer master notes, Accounting tables, or staff Raport tables as a substitute source.

## Privacy and authorization

- Customer identity is derived from the bearer customer session. The client never submits a trusted Customer ID.
- Feedback is stored with `customer_id` for quota integrity and future authorized analysis.
- The feedback catalog is public customer-page metadata and may render before authentication. Authentication is required for submission and remains server-authoritative.
- The Customer Feedback UI must ask the server for authoritative access without gating category visibility on `window.LEKER_CUSTOMER` or any asynchronous page-level identity restoration.
- A stale, absent, or invalid token remains fail-closed because the access endpoint returns `401 CUSTOMER_LOGIN_REQUIRED`; the client keeps the form visible but prevents submission and offers the customer login action.
- Admin Gerai reads only reports from its own store.
- Owner may read reports across stores.
- Management list responses intentionally omit customer ID, customer code, name, phone, username, and email. The UI shows only a protected verified-customer marker.
- Cashier and customer-service surfaces have no Customer Feedback V1 read endpoint.

## Point reward

The report insert, normalized issue inserts, and `customer_point_ledger` reward entry are executed in one D1 batch.

Point ledger row:

- `activity_type = EARN`
- `reference_type = CUSTOMER_FEEDBACK`
- `reference_id = feedback report id`
- `points_delta = 500`
- `source_store_id = feedback store`

The existing customer point-balance read remains `SUM(customer_point_ledger.points_delta)`.

## API

- `GET /api/customer/feedback/catalog`
- `GET /api/customer/feedback/access?store=<CODE>`
- `POST /api/customer/feedback?store=<CODE>`
- `GET /api/admin/customer-feedback?store=<CODE>` for Admin Gerai or scoped Owner reads
- `GET /api/admin/customer-feedback` for Owner cross-store reads

## Deployment invariant

Customer Feedback V1 is not deployment-ready merely because the Worker source builds. The production road must preserve this order:

1. apply remote D1 migrations;
2. verify remote `sqlite_schema` contains both Customer Feedback tables;
3. deploy the Worker.

`npm run deploy` enforces this sequence through `db:migrations:apply` followed by `db:schema:verify` and only then `wrangler deploy`. `scripts/verify-remote-schema.mjs` fails closed when either required table is absent.

Non-production Cloudflare branch previews may use `wrangler versions upload` and therefore are not schema evidence for a migration-changing feature. See `RUNBOOK.md`.

## Compatibility

- Guest ordering remains unchanged.
- Customer login, customer sharing, order creation, sale posting, Accounting, Inventory, and existing sale point logic remain unchanged.
- Existing D1 rows require no backfill.
- Migration is additive.

## Recovery

If remote migration, remote schema verification, or deploy fails, stop promotion. Follow `RUNBOOK.md` and the repository D1 backup / Time Travel recovery discipline. Do not rewrite a previously applied migration or manually create a second feedback source.

## DOC-IMPACT

**REQUIRED** — this contract, ADR-026, migration 0033, Customer UI, management read UI, API routing, deployment schema gate, runbook, and regression tests are part of the same deployed capability. Visible-first category rendering and server-authoritative submission eligibility are part of the Customer UI contract.
