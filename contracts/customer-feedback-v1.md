# Customer Feedback Contract V1

Status: ACTIVE for Prototype Leker

## Purpose

Customer Feedback V1 adds a structured **Kotak Saran** for authenticated customers. Reports are persisted as first-class business facts so Admin Gerai, Owner, and a future Owner AI assistant can evaluate recurring quality signals without depending on free-form chat history. Authorized management may identify the customer account that sent a report, while Cashier/customer-service surfaces remain excluded from the feedback read capability.

## Customer-facing behavior

1. The customer page exposes **Kotak Saran**. After the public feedback catalog loads, the category buttons are rendered immediately. Category visibility must not depend on customer login state or submission entitlement.
2. The customer selects exactly one category:
   - `PRODUCT_QUALITY` / Mutu Produk;
   - `SERVICE` / Pelayanan;
   - `CLEANLINESS` / Kebersihan.
3. Each category offers stable issue codes with customer-readable labels. Multiple issues may be selected.
4. A manual note is available for feedback outside the predefined list.
5. A report must contain at least one selected issue or a non-empty manual note.
6. The page states that reports are delivered to Admin/Owner for management evaluation. The authenticated customer identity may be visible to authorized Admin/Owner, but is not shared to cashier/customer-service staff through this feature.
7. An accepted report earns the explicit Customer Feedback V1 reward of **500 points**. This reward is isolated to this contract and does not define a global point redemption value or generic sale earning ratio.
8. Customer UI receives only whether submission is currently available. Entitlement controls whether the server accepts **Laporkan**, not whether the category catalog or CTA is visible/clickable. The UI must not publish quota thresholds, cooldown rules, internal entitlement type, or entitlement keys.
9. **Laporkan** remains actionable whenever the form is visible. Client-side validation explains missing category/content, login requirement, or generic submission unavailability after the customer presses the CTA. The button is disabled only while a submission request is actively in flight.
10. A successful submission response is returned only after the report batch commits and the server can read back the inserted report for the same report ID, store, and customer. This read-after-write confirmation prevents the customer UI from declaring delivery before persistence is visible to the management read source.

## Submission entitlement

Submission entitlement is enforced only on the server.

- A qualifying sale is a non-voided sale for the selected store, attributed to the authenticated customer, with `total_amount >= 50000`.
- A qualifying sale that occurred after the customer's latest feedback can unlock one new submission.
- If no such sale unlock is available, a customer may submit when they have not submitted another feedback report in the current Asia/Jakarta business month.
- The server stores an internal unique entitlement key and, for sale-backed submissions, the qualifying `sale_id`.
- Concurrency must fail closed. The same monthly entitlement or qualifying sale cannot create two reports.
- A qualifying-sale lookup is an additional unlock, not the baseline entitlement. If that lookup cannot be evaluated because a runtime/schema dependency is unavailable, the server must **not** grant a sale-backed unlock and must continue to the monthly entitlement guard. An already-consumed monthly entitlement remains unavailable. The degraded sale lookup must not turn an otherwise valid monthly path into an HTTP 500.

These rules are intentionally internal and are not rendered in customer-facing copy. The conservative fallback is service resilience only and does not replace schema-drift diagnosis or canonical repair.

## Persistence

Migration `0033_customer_feedback.sql` owns:

- `customer_feedback_reports` for report header, category, manual note, entitlement audit, reward snapshot, store/customer references, and timestamp;
- `customer_feedback_report_issues` for normalized issue-code rows plus immutable label snapshots.

Normalized issue rows are the reporting source for weekly aggregation and future AI analysis. Customer feedback must not be written into `orders`, `sales.note`, customer master notes, Accounting tables, or staff Raport tables as a substitute source.

## Privacy and authorization

- Customer identity is derived from the bearer customer session. The client never submits a trusted Customer ID.
- Feedback is stored with `customer_id` for quota integrity, delivery attribution, and authorized management analysis.
- The feedback catalog is public customer-page metadata and may render before authentication. Authentication is required for submission and remains server-authoritative.
- The Customer Feedback UI must ask the server for authoritative access without gating category visibility or CTA clickability on `window.LEKER_CUSTOMER` or any asynchronous page-level identity restoration.
- A stale, absent, or invalid token remains fail-closed because the access endpoint returns `401 CUSTOMER_LOGIN_REQUIRED`; the client keeps the form and CTA visible, explains that login is required, and the server does not accept the report.
- Admin Gerai reads only reports from its own store.
- Owner may read reports across stores.
- Authorized management list responses may include customer name, customer code, username, phone, and email from the linked customer master so the sender can be identified for follow-up/evaluation. The internal database customer ID is not required in the management response.
- The management report query uses the feedback report as the source of truth and a `LEFT JOIN` to customer identity, so an identity-row anomaly must not hide an otherwise valid feedback report from the inbox.
- Cashier and customer-service surfaces have no Customer Feedback V1 read endpoint and must not receive reporter identity through this feature.

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

Management feedback DTOs may include a `reporter` object containing authorized customer identity fields. This is additive to the existing feedback DTO and does not change the endpoint path or store authorization boundary.

## Admin delivery behavior

- The Admin Gerai Kotak Saran panel is a permanent workspace surface.
- Once the authenticated Admin workspace becomes visible, the feedback panel preloads the current store inbox without requiring the user to discover and press Refresh first.
- Opening Kotak Saran or pressing Refresh performs a fresh no-cache read.
- The inbox count and rows come from `customer_feedback_reports`; category filters operate on the loaded report set.
- Customer identity rendering is management-only and does not create a separate feedback source.

## Deployment invariant

Customer Feedback V1 is not deployment-ready merely because the Worker source builds. The production road must preserve this order:

1. apply remote D1 migrations;
2. verify remote `sqlite_schema` contains both Customer Feedback tables;
3. deploy the Worker.

`npm run deploy` enforces this sequence through the repository's active deployment command. `scripts/verify-remote-schema.mjs` fails closed when either required table is absent.

Non-production Cloudflare branch previews may use a code-only upload and therefore are not schema evidence for a migration-changing feature. See `RUNBOOK.md`.

## Compatibility

- Guest ordering remains unchanged.
- Customer login, customer sharing, order creation, sale posting, Accounting, Inventory, and existing sale point logic remain unchanged.
- Existing feedback rows require no backfill because customer identity is already linked by `customer_id`.
- No new database migration is required for management identity visibility or inbox preload.
- Management DTO expansion is backward-compatible for clients that ignore the added reporter fields.

## Recovery

If remote migration, remote schema verification, or deploy fails, stop promotion. Follow `RUNBOOK.md` and the repository D1 backup / Time Travel recovery discipline. Do not rewrite a previously applied migration or manually create a second feedback source.

## DOC-IMPACT

**REQUIRED** — this contract, ADR-026, Customer UI/management read UI, management response privacy semantics, delivery confirmation, deployment discipline, and regression tests are part of the same deployed capability. Authorized Admin/Owner sender identity, Admin inbox preload, and read-after-write report confirmation are now explicit Customer Feedback V1 behavior.
