# ADR-026 — Private Customer Feedback and Evaluation Facts

Status: ACCEPTED for Prototype Leker

## Context

Prototype Leker already has authenticated customer identity, branch-safe customer sharing, customer-attributed sales, and a point ledger. The customer experience now needs a structured suggestion channel covering product quality, service, and cleanliness.

The report must be useful for weekly management evaluation and future Owner AI analysis. Reporter identity must not be exposed to cashier/customer-service surfaces. Submission frequency must be controlled internally without publishing the quota algorithm to customers.

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
10. Management feedback responses omit direct customer identity. Cashier/customer-service interfaces receive no feedback-list route.
11. Structured feedback facts are intentionally suitable for a future Owner AI assistant. V1 does not implement AI scoring, automated disciplinary conclusions, or AI-generated actions.

## Concurrency and integrity

- Monthly fallback submissions use a unique internal entitlement key.
- Sale-backed submissions reference one qualifying sale and the database enforces one feedback report per qualifying sale.
- Voided sales do not qualify.
- A qualifying sale must occur after the customer's latest feedback to unlock another sale-backed report.
- Report + issue rows + point reward are committed in one D1 batch.

## Consequences

- Weekly reporting can aggregate issue codes without parsing arbitrary prose.
- Customer identity remains available internally for anti-abuse integrity while management views stay privacy-preserving.
- Existing order, sale, Accounting, Inventory, and staff Raport sources remain unchanged.
- Future AI analysis can consume the same canonical feedback facts instead of creating a second comment store.

## Recovery

Migration `0033_customer_feedback.sql` is additive. If promotion fails, use the established prototype D1 backup / Time Travel recovery path and resume the canonical migration chain only after schema state is verified.

## DOC-IMPACT

**REQUIRED** — Customer Feedback V1 adds a new business fact, private entitlement policy, point reward, and management read surface.
