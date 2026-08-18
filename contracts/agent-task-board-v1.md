# Agent Task Board Contract v1

Status: ACTIVE
Contract: `MAXI_AGENT_TASK_BOARD_V1`
Venue: D1 `maxi-agent-bus` (`cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6`), account `Daily Napkin`

## Why a board, and why there

Hana writes a task once. Implementer agents read it later, in their own sessions, without
Hana re-deriving the context — that is the whole point, and the reason the board is worth
building.

The venue is D1 rather than the repository for two reasons:

1. It is the only place every agent family can both read and write today. Zee reaches D1
   through the Cloudflare connector; Karen and Elle have Cloudflare access; Hana has both.
   A repository-only board excludes Zee until `agent-bridge` is deployed.
2. Parallel implementers writing status into git would collide on every commit. Claim and
   progress are mutable coordination state, not reviewable source.

Governance that *should* be reviewed — this contract, module ownership, ADRs — stays in the
repository. Mutable coordination state lives on the board. The split is deliberate.

**The board never lives in `prototype-leker-db`.** Agent coordination is tooling, not product.
Once Leker is multi-tenant, agent state inside a tenant's database would be a boundary
violation with no upside.

## Agent identity

An agent name carries three parts: family, slot, session.

```
karen1.2
│     │ └── session 2 — a fresh context window, no memory of session 1
│     └──── slot 1 — the parallel worker lane, used for anti-collision
└────────── family — karen, elle, hana, zee
```

Bos Cyo's original shorthand was `karen11` / `karen12`. The separator is added deliberately:
without it, `karen11` is ambiguous between slot 1 session 1 and slot 11 session 1, and that
ambiguity becomes unfixable once slot counts reach double digits.

**A session is not a person.** `karen1.2` shares no memory with `karen1.1`. It knows only
what the board and the repository tell it. That is the fact the handoff rule exists to
survive.

## Task lifecycle

```
OPEN ──claim──▶ CLAIMED ──report──▶ REPORTED ──verify──▶ DONE
                   │                    │
                   │                    └──reject──▶ OPEN (re-claimable)
                   └──handoff──▶ CLAIMED (next session)
                   └──block────▶ BLOCKED
```

- **Hana** writes tasks and verifies reports. Only Hana moves a task to `DONE`.
- **Implementers** claim, report, hand off, and block. They never verify their own work.
- A task carries the module it belongs to, so ownership is never guessed.

## What a task must contain

Hana writes intent and contract, not source code. Writing the implementation in the task
defeats the purpose — the implementer's job is the code.

Required fields: `module`, `objective`, `inputs` (files, tables, endpoints to read),
`contract` (ids that must line up, invariants that must hold), `done_when` (checkable
conditions), `forbidden` (what must not be touched).

The `contract` field is the one that prevents ambiguity at query time. State which id joins
to which, in words, e.g. *"`production_runs.recipe_id` must reference an immutable recipe
revision; never join to `manufacturing_recipes` by product alone."*

## The handoff rule

A task may be held by exactly one open claim. When a session ends without finishing, it must
write a handoff naming the next session and describing state, or the work is stranded.

The schema enforces this: a second session cannot claim a task that another session has ever
claimed unless a handoff row names it as the recipient. It is a trigger, not a convention,
because conventions are what failed.

A handoff must record: what is done, what is not, what was learned that is not in the code,
and what the next session must not repeat.

### Why this rule exists

Every mess found in the 2026-08-18 audit traces to a missing handoff:

- `npm run deploy` was pointed at a one-time recovery script three times and never pointed
  back, because no session recorded that it was temporary;
- commit `5fdb353`, titled *"Restore canonical deployment command"*, restored the temporary
  script — the next session did not know what canonical was;
- the `sale` journal rules were created by hand in production on 2026-08-16 and never written
  into a migration, so `store_002` and the third store still cannot post a sale.

None of those were carelessness. They are what happens when a session ends and its knowledge
ends with it.

## Reporting, and when Hana audits

An implementer reports `done_when` outcomes with evidence: commands run and their output,
tests added, rows affected. Claims without evidence are not reports.

Hana reads the report and writes the next task. Hana audits the work itself **only when the
report and observable reality disagree** — tests passing but behaviour absent, a claimed
migration missing from the ledger, a file said to be edited with no diff. Auditing every
report would cost more than doing the work.

## DOC-IMPACT

**REQUIRED** — `MODULE_OWNERSHIP.md` names the owner of each module referenced by a task's
`module` field. A task naming a module absent from that registry is rejected at write time.
