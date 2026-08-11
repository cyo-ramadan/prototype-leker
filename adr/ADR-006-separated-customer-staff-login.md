# ADR-006 — Separated Customer and Staff Login

Status: ACCEPTED for Prototype Leker

## Context

A single unified login form made customer identity and internal employee identity share one entry path. The prototype also allowed more than one staff session per account and a duplicated browser tab could reuse the same staff token. Cashier startup additionally performed several authenticated reads immediately after redirect, which increased perceived login latency and request volume.

## Decision

1. The customer page remains the public entry point and exposes two login tabs only: **Pelanggan** and **Karyawan**.
2. Customer login uses `POST /api/auth/customer-login` and resolves only customer identities inside the selected store/customer-sharing scope.
3. Staff login uses `POST /api/auth/staff-login` and resolves only internal roles: Owner, Admin Gerai, or Kasir. The server determines the internal rank after credential validation.
4. Customer and staff session namespaces remain separate so one customer tab and one staff tab may coexist in the same browser.
5. One staff account may have only one active server session. A second staff login returns `STAFF_SESSION_ACTIVE` unless the user explicitly chooses takeover.
6. D1 triggers enforce one session row per Owner/Admin/Kasir account even when a legacy/direct staff login endpoint is called.
7. Migration `0011_staff_single_session.sql` invalidates all pre-policy staff sessions once during rollout so duplicated/stale legacy tokens cannot survive into the new concurrency model.
8. Customer sessions are intentionally excluded from both the one-time reset and staff single-session rule.
9. One browser profile may have only one active staff tab. A local browser lease blocks duplicate staff tabs. This lease uses `localStorage` heartbeat only and creates no Worker/D1 polling traffic.
10. Direct staff pages without a matching session redirect to the centralized staff entry (`/?login=staff`).
11. Cashier initial/read refresh state is consolidated through `GET /api/cashier/workspace`, returning cashier identity, branch menu, orders, drawer state, and write authority in one authenticated snapshot.
12. Periodic cashier network polling remains disabled. Manual refresh and focus/visibility refresh use the workspace snapshot.
13. Legacy `POST /api/auth/login` remains temporarily available for backward compatibility but is not the canonical UI path.

## Security and compatibility

Staff role and branch scope remain server-derived. Browser tab locking is an additional UX/safety layer and does not replace server authorization. Existing staff sessions are intentionally invalidated once when migration 0011 applies; staff must login fresh afterward. Existing customer sessions and guest checkout are unaffected.

## Recovery

Migration `0011_staff_single_session.sql` deletes existing staff session rows and creates three D1 triggers. It does not alter staff/customer account rows. If deployment fails after migration, restore the previous Worker version and have staff login again as needed. To reverse the policy, drop the three `trg_*_single_session` triggers before retrying a corrected migration. Deleted legacy staff session tokens are not restored; customer session data requires no rollback.

## DOC-IMPACT

REQUIRED — login boundaries, staff session concurrency, browser-tab concurrency, one-time staff session reset, and cashier bootstrap behavior materially changed.
