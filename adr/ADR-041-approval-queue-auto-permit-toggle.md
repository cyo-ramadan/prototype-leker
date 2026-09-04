# ADR-041 — Approval Queue Auto Permit toggle

Status: ACCEPTED for Prototype Leker
Date: 2026-09-04
Decided by: Bos Cyo
Written by: Hana

Amends: ADR-009 point 8.

## Context

Bos Cyo's instruction (verbatim, translated): "for permit, add an Auto Permit
toggle that can be activated. When it's on, permits get ACC'd immediately. In
the field, turning the toggle on is fine, but if something goes wrong, the
responsible admin should be ready to answer for it — so they should already be
able to judge when it's safe to turn on and when it isn't."

ADR-009 point 8 states: "ACC and Reject are explicit management decisions."
That remains true by default. This ADR adds one narrow, explicit, and audited
way a store can delegate that decision to the system instead of a human click.

## Decision

1. **Scope: `approval_requests` only** (CASH_FLOW, GOODS_FLOW including
   Penyesuaian Stok, ASSET — ADR-009). `transaction_void_permits` (Hapus/
   correction permits — ADR-022) is explicitly out of scope: it is a
   materially different risk profile (correcting/reversing a committed fact
   versus posting a forward-looking one). Extending Auto Permit there is a
   separate future decision, not implied by this one.
2. **Per-store toggle**, not global and not per-request-type. `store_approval_settings`
   (migration `0066_store_approval_settings.sql`) holds `auto_permit_enabled`
   plus `enabled_by_role`/`enabled_by_id`/`enabled_at`. Whoever already has
   management authority over that store under `requireManagement`/
   `managementScope()` — Admin Gerai (own store), Owner (any store), Entity
   Admin (stores in its Entity) — may toggle it through
   `GET`/`PATCH /api/management/approval-settings`.
3. **Accountability is the point of this feature, not an afterthought.** Turning
   the toggle on stamps `enabled_by_role`/`enabled_by_id`/`enabled_at` with the
   acting account. Turning it off does not clear those fields — they remain the
   answer to "who last turned this on" even while it reads OFF. Every
   `approval_requests` row Auto Permit posts is stamped `approved_by_role =
   'AUTO_PERMIT'`, `approved_by_id = <that same enabled_by_id>` — never the
   submitting cashier's id — so an auto-approved row always traces back to the
   specific account that made the toggle-on decision, exactly as Bos Cyo asked.
4. **Same posting contract as a human ACC, not a parallel implementation.**
   `src/approval-queue.js` extracts the decision logic the management `PATCH`
   endpoint already used (`rejectStaleStockAdjustment` →
   `buildOperationalPostingStatements` → `env.DB.batch` →
   `cashFlowAccountingAfterCommit`) into one shared `applyAccDecision()`, called
   from both the management ACC endpoint and the cashier submission path when
   Auto Permit is on. There is no second, drift-prone copy of the posting logic.
5. **Failure semantics are unchanged from today's manual ACC, including under
   Auto Permit:**
   - A stale `STOCK_ADJUSTMENT` snapshot is still rejected by
     `rejectStaleStockAdjustment` (existing behavior, unchanged) — Auto Permit
     does not blindly post against data proven wrong at posting time.
   - Any other posting failure (e.g. a stock/asset guard) leaves the row
     `pending_approval`/`unposted`, because `env.DB.batch()` rolls the entire
     attempt back atomically, including the status-update statement. Auto
     Permit never silently rejects something a human could still review — a
     failed auto-approval attempt is reported back to the cashier and the row
     waits exactly where it would have without Auto Permit at all.
6. **UI surfaces the responsibility, it does not hide it.** The toggle lives in
   the per-store Admin panel only (`public/management-approval-queue.js`,
   `mountBranchAdmin()` — not the Owner's cross-store approval list, which has
   no single store to scope a toggle to). Turning it on requires an explicit
   confirmation dialog naming the consequence before the request fires.

## Data Impact

Migration `0066_store_approval_settings.sql` adds `store_approval_settings`,
additive only, `store_id` primary key referencing `stores(id)`. No existing
table or column is modified.

## Security

- Toggle read/write is gated by the same `managementScope()`/`requireManagement`
  authorization every other approval-queue endpoint already uses — store
  isolation is server-side, unchanged (CLAUDE.md invariant #5).
- `approved_by_role = 'AUTO_PERMIT'` is a distinct value from `OWNER`/`ADMIN`/
  `ENTITY_ADMIN` specifically so an auto-approved row is never mistaken for a
  human's direct decision in an audit trail or Raport read.
- Money and inventory posting still go through the one Accounting-owned bridge
  path (`cashFlowAccountingAfterCommit`); Auto Permit introduces no second
  Accounting posting route (CLAUDE.md invariant #4).

## Performance

No polling introduced. The toggle state is read once per cashier submission
(a single indexed lookup by `store_id` primary key) and once when an Admin
opens the Approval Queue tab.

## Recovery

Disabling the toggle takes effect on the next submission; it does not touch
rows already posted. A store that never touches this feature behaves exactly
as before this ADR — `auto_permit_enabled` defaults to `0`.

## Documentation Impact

DOC-IMPACT: REQUIRED. `KNOWN_ISSUES.md` records the Auto Permit toggle under
the Approval Queue area. This ADR is the authoritative amendment to ADR-009
point 8 — ACC/Reject remain explicit management decisions by default; Auto
Permit is the one explicit, audited, store-scoped exception a store can opt
into.
