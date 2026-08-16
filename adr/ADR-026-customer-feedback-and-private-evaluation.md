# ADR-026 — Customer Feedback and Authorized Management Evaluation Facts

Status: ACCEPTED for Prototype Leker

## Context

Prototype Leker already has authenticated customer identity, branch-safe customer sharing, customer-attributed sales, and a point ledger. The customer experience needs a structured suggestion channel covering product quality, service, and cleanliness.

The report must be useful for weekly management evaluation and future Owner AI analysis. Cashier/customer-service surfaces must not receive reporter identity or feedback-list access. Admin Gerai and Owner are authorized management actors and may need the sender identity to follow up and evaluate a report in context.

A deployment incident also demonstrated that Worker source and D1 schema can temporarily diverge when code for a migration is deployed before the matching remote database state exists. Customer Feedback therefore needs an explicit migration-first deployment invariant and must not claim successful report delivery before persistence can be confirmed.

## Decision

1. Customer feedback becomes its own domain source in `customer_feedback_reports` and `customer_feedback_report_issues`.
2. Customer identity is resolved server-side from the customer session.
3. Every report belongs to the currently selected `store_id`, even when customer identity is authorized through a sharing group.
4. Categories are stable codes: `PRODUCT_QUALITY`, `SERVICE`, and `CLEANLINESS`.
5. Predefined issues are stored as normalized stable issue-code rows with a label snapshot. Manual text is stored on the report header.
6. The server privately evaluates submission entitlement from feedback history and qualifying customer-attributed sales. The customer UI receives only an available/unavailable result.
7. One accepted Customer Feedback V1 report awards 500 points through the existing `customer_point_ledger`.
8. The feedback reward does not define global loyalty redemption value, sale earning ratio, expiry, or promotion rules.
9. Admin Gerai may read only feedback for its own store. Owner may read all stores.
10. Authorized Admin Gerai/Owner management responses may include linked customer name, customer code, username, phone, and email. Cashier/customer-service interfaces receive no feedback-list route and no reporter identity through this feature.
11. The feedback report remains the management read source of truth. Customer identity is attached with a `LEFT JOIN` so a missing/legacy customer identity row cannot make a persisted feedback report disappear from the inbox.
12. A successful customer submission response is returned only after the report/issue/reward batch commits and the inserted report can be read back for the same report ID, store, and customer.
13. The Admin Gerai inbox preloads after the authenticated workspace becomes visible and also refreshes when Kotak Saran is opened or Refresh is pressed.
14. Structured feedback facts are intentionally suitable for a future Owner AI assistant. V1 does not implement AI scoring, automated disciplinary conclusions, or AI-generated actions.
15. Production promotion for this capability must preserve the repository's remote D1 verification and canonical Worker deployment discipline. A successful code/preview build alone is not schema evidence.

## Concurrency and integrity

- Monthly fallback submissions use a unique internal entitlement key.
- Sale-backed submissions reference one qualifying sale and the database enforces one feedback report per qualifying sale.
- Voided sales do not qualify.
- A qualifying sale must occur after the customer's latest feedback to unlock another sale-backed report.
- Report + issue rows + point reward are committed in one D1 batch.
- After commit, the request confirms the report header is readable before responding with customer-visible success.

## Privacy boundary

Customer Feedback V1 uses role-based confidentiality rather than anonymous management reporting:

- Admin Gerai may identify senders only for reports in the Admin's own store.
- Owner may identify senders across authorized store reads.
- Cashier and customer-service staff do not receive the management feedback endpoint.
- Customer identity continues to be derived server-side; clients cannot choose or spoof a sender ID in the feedback payload.
- Internal session credentials, password hashes, and unrelated customer data are never included in feedback management responses.

## Deployment integrity

- Repository deployment tooling owns production promotion.
- Remote D1 readiness is verified before a schema-dependent Worker is considered deployable.
- `scripts/verify-remote-schema.mjs` checks required Customer Feedback objects.
- Code previews are not proof that matching production schema exists.
- Operational recovery and evidence requirements live in `RUNBOOK.md`.

## Consequences

- Weekly reporting can aggregate issue codes without parsing arbitrary prose.
- Admin/Owner can identify the authenticated customer who sent a report and perform authorized follow-up.
- A broken customer identity join cannot silently remove a valid report from the inbox.
- Customer-visible success has stronger delivery meaning because the server confirms the persisted report after commit.
- Existing order, sale, Accounting, Inventory, and staff Raport sources remain unchanged.
- Future AI analysis can consume the same canonical feedback facts instead of creating a second comment store.

## Recovery

Migration `0033_customer_feedback.sql` remains the additive storage source. This decision does not require a new migration because `customer_id` is already stored on each report. If remote schema verification or promotion fails, use `RUNBOOK.md` and the established prototype D1 backup / Time Travel recovery path. Resume the canonical deployment chain only after actual remote state is verified.

## DOC-IMPACT

**REQUIRED** — Customer Feedback V1 now explicitly includes authorized management-visible sender identity, Admin inbox preload, read-after-write delivery confirmation, private entitlement policy, point reward, management read surface, and the existing deployment integrity boundary.
