# Una Workspace V1

Requested by Bos Cyo, 2026-10-11. One conversation and one workspace remain usable
at the same time; future live voice must update the same structured tasks.

## Ownership and boundaries

- Chat is the conversation surface. Its small draft card opens the task in Workspace.
- Workspace is a list of tasks. One task contains one canonical Una draft, including
  a batch draft. Tasks persist for their authenticated account and entity/store scope.
- This release builds Workspace; it does not implement a full duplex live call.
- Existing Una model, reasoning level, business endpoints and Accounting rules stay
  governed by their existing contracts. Workspace creates no financial ledger.

## API

`/api/caca/workspace` uses the ordinary `?store=CODE` or `?lingkup=entity` scope.

| Request | Behavior |
|---|---|
| GET collection | Read authenticated account's tasks in the selected scope |
| POST collection | Save a draft or incomplete pending task |
| GET `/:id` | Recover structured task with current revision and progress |
| PATCH `/:id` | Compare revision, regenerate edited captures, or cancel |
| POST `/:id/catat` | Approve/execute one canonical step with revision and expected cursor |

Task identity includes principal, entity, and store identity, never a browser-asserted
recipient. Every read, revision and approval rechecks current authorization. A store
moved to another entity cannot carry old private tasks into that entity.

## Review and execution

- Browser edits change captures, then the server prepares the draft again. The newly
  displayed revision needs fresh human review before it can execute.
- Content editing stops once execution starts, preserving completed batch prefixes.
- Approval atomically claims the expected revision/cursor before calling the fixed
  canonical `/api/caca/catat` route through the main router. No arbitrary endpoint.
- Persist each confirmed successful step before allowing another step. A replay of
  an already recorded step must never produce another business write.
- A network error, process interruption or unsuccessful canonical result may follow
  a committed business write. Such ambiguity is blocked for manual checking and is
  never automatically retried. Workspace must not claim exactly-once transactions
  across the business endpoint and the workspace database.
- Pause acts between steps. It does not interrupt half a posted transaction.
- Closing Workspace only changes the view. It does not approve, delete or cancel.

## Privacy and transport

- Durable state is JSON on the server, not restored executable chat HTML.
- Password/secret drafts can use an explicitly labeled memory-only task. Failure
  to save an ordinary task does not silently enable this exceptional path.
- Never persist initial passwords, session tokens or one-shot secrets in captures,
  task results, conversation history or errors. Credentials follow existing flows.
- No periodic network polling. Read on open, action and focus; later voice updates
  enter the same workspace adapter, without a separate draft execution path.
- A stale chat response must not overwrite a manually edited or newly selected task.
  A revision conflict preserves local work and requires choosing the current draft.
- Late list responses cannot reduce the displayed revision, cursor, saved results or
  terminal status. An accepted selected draft refresh also refreshes chat captures.
  Only direct readback may resolve a locally uncertain network outcome; server
  uncertainty remains blocked for manual review.

## Validation and release

Regression coverage must verify account/store isolation, revision conflicts, reload,
concurrent approval, batch resume/pause, ambiguous completion and secret handling.
Canonical deploy still applies migrations, verifies remote schema, then promotes
Worker. A branch push may already apply migration0150 to production; it is additive.

## DOC-IMPACT

2026-10-11: New Workspace contract. Call/voice provider integration remains future work.
