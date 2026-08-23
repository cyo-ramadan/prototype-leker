# Agent Task Board Contract v1

Status: ACTIVE
Contract: `MAXI_AGENT_TASK_BOARD_V1`
Dikerjakan oleh: `hana1.1` — arsitektur, MAXI agent roster

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

**A new task is not a new slot.** Slot counts parallel lanes — how many tabs Bos Cyo actually
has open — not how many tasks a family has picked up. An agent that releases one claim and
immediately claims another, still the same running instance, keeps its slot and stays on the
same session too; nothing about finishing a task resets its context. A slot number only
climbs when Bos Cyo opens a genuinely new parallel lane himself. Found in production, 2026-08-22:
a GitHub-only Karen relaying through one Issue thread — same conversation, same back-and-forth,
task after task — was assigned a fresh slot for every task instead of the next session under
one slot (`karen5.1`, `karen6.1`, `karen7.1`... instead of `karen5.1`, `karen5.2`, `karen5.3`).
The board still worked — nothing here is a claim-safety issue — but Bos Cyo lost the one thing
slot numbers exist to give him: which lane a piece of in-flight work is actually running in.

## Task lifecycle

```
OPEN ──claim──▶ CLAIMED ──report──▶ REPORTED ──verify──▶ DONE
                   │                    │
                   │                    └──reject──▶ OPEN (re-claimable)
                   └──handoff──▶ CLAIMED (next session)
                   └──block────▶ BLOCKED
```

- **Hana** writes tasks and reviews reports.
- **Implementers** claim, report, hand off, and block. They never verify their own work.
- A task carries the module it belongs to, so ownership is never guessed.

## Authority — Hana is not a gate

An earlier draft of this contract said only Hana moves a task to `DONE`. That was wrong. The
Constitution is explicit: *"Reviewer or affected-owner approval is advisory and may not block
starting, completing, merging, deploying, or reporting PASS."* A standing approval gate held
by one agent contradicts that, and makes the whole board stop when that agent stops.

What actually blocks work:

| Gate | Held by | Blocking |
|---|---|---|
| Technical gates — tests, `npm run check`, schema constraints, migrations | automation | **yes** |
| Production data mutation | **Bos Cyo**, per Constitution §5 | **yes** |
| Architecture decisions | Hana, expressed as ADRs and contracts written *in advance* | binding, not live |
| Review of a finished report | Hana | **advisory** |

Hana's authority is exercised through artifacts, not through permission. An ADR that already
exists binds a task written next week whether or not Hana is awake. That is the difference
between deciding and gatekeeping, and it is what lets the work continue without her.

A task marked `self_closing` reaches `DONE` on a report whose evidence satisfies its
`done_when`, with no verdict. It is for reversible work behind technical gates — the ordinary
case. A task marked `mutates_production` can never be self-closing; it waits for Bos Cyo, not
for Hana.

## When Hana runs out of context

Hana is subject to the same rule as everyone else, and being the architect makes that more
important rather than less.

- **Work in flight continues.** Claims, reports and handoffs need the board, not Hana.
- **Tasks are written ahead.** A queue of `OPEN` tasks is the deliverable; writing them one
  at a time on demand recreates the dependency this design exists to remove.
- **Reports do not rot.** `self_closing` tasks close on their own evidence. A non-self-closing
  report left unreviewed past its window escalates to Bos Cyo — it never sits waiting for an
  agent who is not coming back.
- **Hana hands off too.** A session ending mid-architecture writes the same handoff it
  demands of others: what is decided, what is open, what was learned, what not to repeat.

An architecture that only works while one particular agent has budget left is not an
architecture. It is that agent's memory, and memory is what keeps failing here.

## What a task must contain

Hana writes intent and contract, not source code. Writing the implementation in the task
defeats the purpose — the implementer's job is the code.

Required fields: `module`, `objective`, `inputs` (files, tables, endpoints to read),
`contract` (ids that must line up, invariants that must hold), `done_when` (checkable
conditions), `forbidden` (what must not be touched).

The `contract` field is the one that prevents ambiguity at query time. State which id joins
to which, in words, e.g. *"`production_runs.recipe_id` must reference an immutable recipe
revision; never join to `manufacturing_recipes` by product alone."*

## Editing a task already on the board

`trg_claim_path_conflict` only fires `BEFORE INSERT ON task_claims`. It says nothing about
`UPDATE tasks` or `INSERT`/`DELETE` on `task_paths` — so nothing in the schema stops a session
from rewriting a task's `title`, `brief`, or `task_paths` out from under a claim another
session is actively holding. This was found in production, not designed against on paper: a
Hana session with no memory of an in-progress claim edited `IKAN-FRONTEND-REWIRE-02` to add
`src/index.js`, the exact file `karen-BS-DISPATCH-GATING` already had an open claim on — the
edit landed clean because the trigger never saw it.

**Before saving any edit to a task that is not brand-new** — paths added or changed, brief
rewritten, title changed — run the same check the trigger would run if it could:

```sql
SELECT tp.task_id, tp.path_prefix FROM task_paths tp
JOIN task_claims c ON c.task_id = tp.task_id AND c.released_at IS NULL
WHERE tp.path_prefix LIKE '<NEW_OR_CHANGED_PATH>%' OR '<NEW_OR_CHANGED_PATH>' LIKE tp.path_prefix || '%';
```

Non-empty and the conflicting task isn't the one you're editing → the edit collides with a live
claim. Either hold the edit until that claim releases, or narrow it to exclude the contested
path and let the claimant add it back themselves once free (self-service rule in
`agent-bus/CLAIM-PROMPT.md` covers exactly this). This applies to whoever is writing the edit —
Hana, Bos Cyo typing SQL directly, or a future agent family with board write access — because
the trigger cannot tell who is asking.

## Self-issued tasks — Bos Cyo speaks in a sentence, the agent writes the SQL

Every task above assumes Hana (or Bos Cyo) already wrote a row in `tasks`. That is the right
default when the work is being planned. It is the wrong default when Bos Cyo just wants to
hand one agent a small, direct instruction and does not want to type SQL to make that
possible — and making him type SQL to get a small thing done is exactly the friction that
pushes people to skip the board entirely, which is the failure mode this section exists to
prevent.

**An implementer may write its own task row** when Bos Cyo pastes a plain-language instruction
directly into its session, under all of the following:

1. The agent registers itself and checks the board first, same as always. If an open task
   already covers the instruction, it claims that one — self-issuing is for when nothing does.
2. The agent picks a `kind` it is actually registered for in `agent_roles`. It does not invent
   a kind to make the work fit; if no registered kind fits, that is itself a sign the work
   belongs to a different family, and the agent says so instead of claiming.
3. `issued_by = 'BOS_CYO'`, never the agent's own family — the row must say who actually asked
   for the work, not who happened to type the INSERT.
4. The agent declares `task_paths` **before** claiming, from its own honest read of what it is
   about to touch. This is the one step that cannot be skipped: it is the only thing that
   protects a second agent, self-issuing an unrelated instruction at the same time, from
   silently colliding on the same file. Declaring `src/` too broadly to be safe is fine;
   declaring nothing is not.
5. If the instruction reads as production data mutation, accounting policy, or anything
   Constitution §5 reserves for Bos Cyo, the row is written with `mutates_production = 1,
   self_closing = 0` — the same as any other task of that shape. Self-issuing changes who
   writes the row, not what it is allowed to close on its own.
6. Everything downstream is identical to a Hana-written task: claim, work inside the declared
   paths only, report with evidence, escalate instead of guessing.

The self-contained prompt in `agent-bus/CLAIM-PROMPT.md` carries the exact SQL for this, so an
agent follows it the same way it follows a claim — no separate protocol to learn.

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
