# MAXI Agent Bus MCP Worker

Canonical source for the existing `maxi-agent-bus-bridge` Cloudflare Worker.
The Worker extends the active D1 board; it does not create another connector or
another database.

## Runtime

- Worker: `maxi-agent-bus-bridge`
- D1 binding: `AGENT_BUS`
- D1 database: `maxi-agent-bus`
- MCP authentication: existing `MCP_AUTH_TOKEN` Worker secret
- connector identity: `MCP_CALLER_FAMILY=karen`
- project allowlist: `MCP_ALLOWED_PROJECTS=leker`

`MCP_AUTH_TOKEN` is never stored in this repository, logged, or returned from a
tool call. Changing the caller family or project allowlist is an authority
change and must be reviewed as such.

## V1 write surface

`board_update_open_task` changes only these fields:

- `title`
- `brief`
- `acceptanceCriteria`
- `forbidden`
- `paths` (complete atomic replacement)
- `mutatesProduction`
- `selfClosing`

The target must exist, remain `OPEN`, have no active claim, belong to the
configured caller family, be inside the configured project allowlist, and have
a task kind registered for that family. Implementation-task paths cannot be
empty. Paths are normalized, deduplicated, limited to 49 characters, and checked
against active claims immediately before the write. A short-lived D1 write
intent rechecks the OPEN/unclaimed invariant inside the atomic batch; existing
claim and path-collision triggers retain authority.

Existing read, registration, claim, escalation-list, and report tools keep
their names and inputs. `board_get_task` retains its existing comma-separated
`paths` field and adds `task_paths` as an ordered array.

## Verify locally

```sh
node --test agent-bus/test/agent-bus-worker.test.js
npm test
npm run check
```

## Deploy

Apply the additive trigger migration before promoting the Worker:

```sh
npx --yes wrangler d1 migrations apply AGENT_BUS --remote --config agent-bus/wrangler.jsonc
npx --yes wrangler deploy --config agent-bus/wrangler.jsonc
```

The existing Worker secret survives a same-name deployment. Deployment evidence
must include the D1 migration result, Worker health version, authenticated
`tools/list`, and one authorized update/read-back smoke test. Do not paste the
MCP token into chat or commit it.

## Recovery

The migration adds one internal intent table and one guard trigger. If it must be
rolled back, capture a D1 Time Travel bookmark first, deploy the prior Worker
version, then remove these objects in a governed recovery command:

- `trg_board_write_intent_open_unclaimed`
- `board_write_intents`

Task data and task paths need no data migration.

## DOC-IMPACT

**REQUIRED** — this file is the canonical source, authority, deployment, and
recovery reference for the MAXI Agent Bus MCP Worker.
