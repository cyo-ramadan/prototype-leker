# ADR-045 — Rekening Bersama (Entity Shared Accounts)

Status: ACCEPTED for Prototype Leker
Date: 2026-09-20
Decided by: Bos Cyo
Written by: Hana

## Context

Bos Cyo's instruction (verbatim, translated): "one `entity_id` has one central
account owned by the entity, not the store. All `store_id`s under the same
`entity_id` share that same account. Need a per-`store_id` breakdown of that
account's balance... This applies whenever payment goes in or out through this
account (e.g. 'Rekening Maxi Malang', name configurable) -- give it a settings
panel at Entity level. While at it, let the same panel create more than one
shared account (e.g. 'Rekening Bos Cyo', 'Hutang Bos Cyo'). Remember: this must
be outside Accounting."

Today, every existing `store_id` already has its own dedicated `entity_id`
(migrations `0039`/`0052`, one Entity per gerai). This ADR doesn't change that
1:1 default -- it makes the schema correctly support N stores per Entity going
forward, without migrating any existing data.

## Decision

1. **New tables, fully outside Accounting**: `entity_shared_accounts` (registry,
   one row per named account, N per entity), `entity_shared_account_ledger`
   (append-only, immutable, source of truth for every balance derivation),
   `entity_shared_account_transfers` (mutable header/state-machine for the
   two-phase inter-store transfer). None of these reference
   `chart_of_accounts`, `journal_rules`, or `entity_journal_headers/lines`.
   Amounts are plain rupiah `INTEGER`, not the `x1,000,000` scaled format used
   for Accounting-authoritative fields (CLAUDE.md invariant #1 names Average
   Cost/HPP/journal amount specifically) -- this mirrors
   `operational_receivables_payables`/`cash_ledger_entries`, the closest
   sibling operational ledgers, not the Accounting journal shape.
2. **Balance is always derived, never stored/updated directly.** Per-store
   composition = `SUM(IN) - SUM(OUT)` over every ledger row for that store,
   including both legs of a transfer. The account's real total =
   `SUM(IN) - SUM(OUT)` over **non-TRANSFER** rows only -- a transfer is by
   definition a zero-sum reallocation of composition, it must never move the
   real total. This gives the invariant Bos Cyo asked for for free:
   `total = sum(store balances) + sum(in_transit)` (proof in the migration's
   header comment and exercised directly in
   `test/entity-shared-accounts.test.js`).
3. **Transfer is two-phase, `IN_TRANSIT -> COMPLETED`, one-way.** Creating a
   transfer writes the OUT leg for the source store *immediately* (its
   composition drops right away) and holds the amount in an "in transit"
   bucket that belongs to neither store; completing writes the IN leg for the
   destination. The header table's `status` is the single source of current
   truth; individual ledger rows are immutable facts about what happened, not
   live state. A `BEFORE UPDATE OF status ... WHEN OLD.status = 'COMPLETED'`
   trigger that raises `SHARED_TRANSFER_ALREADY_COMPLETED` -- rather than a
   `WHERE status = 'IN_TRANSIT'` filter on the UPDATE -- is what makes
   completing the same transfer twice safe: the trigger only fires (and can
   abort the whole `db.batch()`, rolling back the IN-leg INSERT with it) when
   the row is actually matched. A `WHERE`-based filter would let a second,
   racing completion silently affect 0 rows while its ledger INSERT still
   committed, double-crediting the destination.
4. **No overdraft guard.** CLAUDE.md invariant #8 ("saldo negatif bukan bug")
   applies here on purpose -- a debt-style account like "Hutang Bos Cyo" is
   expected to carry a negative composition for whichever store owes it nothing
   here should stop a transfer just because it pushes a store's balance below
   zero.
5. **Auto-posting hook lives at the POS Core commit boundary, as a sibling of
   the Accounting bridge, never inside it.** `payment_methods` gets one new
   nullable column, `shared_account_id` (sibling of the existing
   Accounting-owned `account_id`, not a replacement) -- POS Core already
   states in `src/pos-payment-methods.js` that it owns payment identity and
   keeps Accounting's account mapping out of its boundary. `src/index.js`'s
   existing `attachAccountingBridgeIfEnabled` composition point for
   SALE/PURCHASE/EXPENSE gets a new sibling step,
   `attachSharedAccountLedgerIfApplicable`, run *after* (not inside) the
   Accounting dispatch. It looks up the fact's `payment_method` code (sales/
   purchases/expenses store the method's **code**, not its id -- migration
   `0008`), and if that store's payment method is tagged to a shared account,
   posts one ledger row. It is best-effort and never throws: a failure here
   must not roll back or change the response of a transaction that already
   committed.
6. **CASH_FLOW is explicitly out of scope for the auto-posting hook.**
   `CASH_FLOW` approval requests resolve their counterpart through
   `accountingCounterpartRuleId` (a `journal_rules` reference), not through
   `payment_methods` -- there is no payment-method concept to tag there today.
   Wiring Cash Flow in would mean tagging an Accounting-owned table
   (`journal_rules`), which conflicts directly with point 5's boundary. This is
   a known, intentional gap, not an oversight: point 5's mechanism doesn't
   extend to it, and closing it needs its own design decision from Bos Cyo,
   not a forced fit here.
7. **Configuration lives at Entity Admin; the transfer flow's create/complete
   lives at Admin Gerai.** Creating/renaming/deactivating a shared account, and
   its entity-wide total+breakdown view, are Entity-level decisions
   (`public/entity-admin.js`, new "Rekening Bersama" tab) -- only Entity Admin
   or Owner can do this (`sharedAccountScope().canManageAccounts`). Initiating
   or accepting a transfer is a store-level operational act, so it lives in
   Admin Gerai (`public/admin-shared-accounts.js`, new tab in
   `branch-admin.html`): the source store's Admin Gerai creates it, the
   destination store's Admin Gerai (or Entity Admin/Owner, for oversight)
   completes it. `?store=` scoping follows the exact `requireManagement`/
   `managementScope` idiom already used by `src/approval-queue.js` and
   `src/business-settings.js` -- including the same "Entity Admin/Owner must
   pass an explicit `?store=` or the request resolves against the wrong
   default store" trap documented across this repo's tests.

## Consequences

- No existing table's meaning changes. No existing store's default composition
  behavior changes (an Entity with exactly one store today behaves exactly as
  before -- its one store's balance is the whole account's total).
- `inventory_ledger_entries`/`cash_ledger_entries`-style constraints (`UNIQUE`
  on a decision-authority column) were deliberately **not** copied here: a
  shared account's ledger row is never a decision record the way an
  `approval_requests` posting is, so no equivalent uniqueness constraint was
  needed.
- A future decision to extend the auto-posting hook to CASH_FLOW, or to add a
  `CANCELLED` transfer state (an in-transit transfer currently has no undo
  path once created), is intentionally left open here rather than pre-built,
  per Bos Cyo's stated scope.

Schema: `migrations/0111_entity_shared_accounts.sql`. Implementation:
`src/entity-shared-accounts.js`, `src/index.js` (`attachSharedAccountLedgerIfApplicable`),
`src/business-settings.js`/`src/accounting-settings.js` (`payment_methods.shared_account_id`
wiring), `public/entity-admin.js`, `public/admin-shared-accounts.js`,
`public/admin-accounting-settings-comfort.js`. Tests:
`test/entity-shared-accounts.test.js`.
