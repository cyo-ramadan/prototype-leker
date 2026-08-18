# Module Ownership
Dikerjakan oleh: `hana1.1` — arsitektur, MAXI agent roster


Constitution §5: *"Every system and shared interface must have an owner."* This registry is
that record. A task written to the board (`MAXI_AGENT_TASK_BOARD_V1`) names a `module`, and a
module absent from this table is not a valid task target.

Ownership means responsibility for the module's contract and invariants — not exclusive
write access. An agent may read anything.

| Module | Owner | Source | Contract / rules |
|---|---|---|---|
| **architecture** | `hana` | `adr/`, `contracts/` | ADR-030, Constitution, Integration Contract Standard |
| **accounting** | *unassigned* | `src/accounting-*.js` | ADR-017, ADR-019, ADR-029, `contracts/accounting-*.md` |
| **accounting-settings** | *unassigned* | `src/accounting-settings.js`, `src/warehouse-settings.js` | ADR-017, `contracts/accounting-settings-v1.md` |
| **operasional** | `karen` | `src/cashier-*.js`, `src/orders*.js`, `src/operational-posting.js` | ADR-029, `contracts/cashier-transaction-composition-v1.md` |
| **produksi** | `elle` | `src/cashier-production.js`, `src/stock-production.js`, `src/manufacturing-master.js` | ADR-012, ADR-013 |
| **inventory-costing** | *unassigned* | `src/admin-stock.js`, `src/product-*.js` | ADR-015, ADR-020 |
| **approval** | *unassigned* | `src/approval-queue.js`, `src/transaction-void-permits.js` | ADR-009, ADR-022 |
| **identity-tenancy** | `hana` | `src/stores.js`, `src/owner-auth.js`, `src/*-auth.js`, `migrations/0039_*` | ADR-030, ADR-001, ADR-006 |
| **customer** | *unassigned* | `src/customers.js`, `src/customer-*.js` | ADR-002, ADR-005, ADR-026 |
| **platform** | `hana` | `src/index.js`, `src/http.js`, `src/db*.js` | routing, one route one owner |
| **agent-tooling** | `hana` | `agent-bridge/`, `agent-bus/` | `contracts/agent-task-board-v1.md` |

## Rules for every agent

1. **Read before writing.** `CLAUDE.md`, then the contracts named for your module. A session
   that skips this re-derives decisions that were already made, usually wrongly.
2. **Stay inside your module.** Touching another module's tables or internals is a boundary
   violation even when it works. Raise it instead; the owner decides.
3. **One route, one owner.** Two handlers claiming one path is how a void-unsafe copy of the
   reconciliation endpoint survived unnoticed.
4. **Register transaction-capable features before closing.** A feature that moves money must
   exist in `transaction_categories` + `journal_rules` first, or it leaks out of Accounting
   silently and is only discovered when the numbers are already wrong.
5. **Never decide accounting or inventory policy.** Fail closed and ask. Constitution R2 puts
   those with Bos Cyo.
6. **Hand off or the work is stranded.** See below.
7. **Report with evidence.** Commands run, output, tests added. A claim is not a report.

## Session naming and handoff

An agent identity is `family` `slot` `.` `session` — `karen1.2` is family `karen`, slot 1,
its second session. Slots are the anti-collision lane: `karen1` and `karen2` may work in
parallel on different modules, never the same one.

**`karen1.2` shares no memory with `karen1.1`.** It knows only what the board and the
repository tell it. So a session that ends unfinished must write a handoff naming its
successor and recording: what is done, what is not, what it learned that is not visible in
the code, and what the next session must not repeat.

The board enforces this — a new session cannot claim a task another session has held unless
a handoff names it. That is a database trigger rather than a rule of etiquette, because
etiquette is what failed: the deploy command was hijacked three times and never restored, a
commit titled *"Restore canonical deployment command"* restored the wrong thing, and the
`sale` journal rules were created by hand in production and never written into a migration.
Every one of those is a session whose knowledge died with it.

## DOC-IMPACT

**REQUIRED** — a new module in `src/` is added here in the same changeset, with its owner and
its contract. Unowned modules are how invariants quietly lose their guardian.
