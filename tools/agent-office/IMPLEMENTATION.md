# Implementation record — v0.1

Author: Karen / karen22.1. Requested by Bos Cyo. Date: 2026-10-08.

## Delivered

A standalone local application under `tools/agent-office/` with no npm runtime dependencies: Canvas 2D office, deterministic animation states, editable local personas, offline demo, authenticated collector, SQLite history, SSE snapshots, Claude hook adapter, additive hook installer/uninstaller, and an explicit CLI process wrapper. CLI supports named roles and tasks without model calls. Task metadata is labelled as launcher-reported information.

Code is isolated from POS runtime and deploy configuration. No migrations, Cloudflare queries, model API calls, or external telemetry were added. No software was installed on Bos Cyo's laptop. Browser QA dependencies were installed only in the temporary test workspace, not in the application package.

## Verification

Environment: Linux x64, Node v24.19.0; headless Chromium 153 through Playwright for UI checks.

| Check | Result |
|---|---|
| `npm test` from repository root | 1,631 passed, 0 failed, 0 skipped; 67.8s on final functional revision |
| `npm run check` from repository root | exit 0 |
| `npm --prefix tools/agent-office test` | 11 passed, 0 failed |
| `npm --prefix tools/agent-office run check` | exit 0 |
| Desktop 1440px / mobile 390px | inspected screenshots; no horizontal overflow |
| Demo work/idle/task/approval interaction | passed |
| Edit name/role/character presentation | passed |
| Economy mode | interacted with successfully |
| Live HTTP ingestion + SSE, two synthetic hook sessions | passed |
| Collector disconnect | UI changes to disconnected |
| Open `preview.html` directly without server | four simulated agents rendered |
| Browser page errors | none |

Unit/integration tests cover normal exit vs cancel vs crash, tool failure, approval exclusion from stall warning, stale telemetry, events-only coverage, ordering/dedup, session identity isolation, redaction of prompt/source/tool outputs, profile persistence, restart stale state, auth boundaries, Origin/Host rejection, payload limit, installer preservation, and two real Node child processes (normal vs exit 7). A late process exit refines an earlier SessionEnd; a resumed native session can work again without resurrecting terminal state from stray tool events.

The two child processes are test harnesses, not Claude agents. Hook payloads are protocol fixtures. No claim of real Claude Code, DeepSeek, Codex, or native Windows validation is made.

## Design deltas and remaining integration

1. Canvas characters and furniture are procedural vector shapes instead of a bitmap atlas. No third-party pixel assets are used. Custom sprite upload remains future work; four placeholder character types are supported.
2. Runtime SQLite is `node:sqlite`, requiring Node >=22.13. No driver download.
3. Producer events are best-effort with timeout, without a durable queue. Lost events during collector downtime are not reconstructed.
4. Identity/role/task comes from the named launcher; hooks-only identities default per workspace. Unknown personas do not infer SEO work from file contents.
5. Agent Bus/Workboard/GitHub live integrations and path overlap warnings remain unavailable in this MVP and are visibly labelled. Monitoring cloud agents requires a supported runtime event source.
6. Hooks preserve original permissions and emit no permission decision. HTTP dashboard cannot invoke shell/restart/kill agents.
7. No performance SLA is claimed. Source web payload is about 40 KB uncompressed, without downloaded fonts/images. CPU/RAM and 30-minute benchmark on the user's device remain unmeasured.
8. Claude Code + alternative-model compatibility remains a separate profile test; configured provider/model is not asserted to be actual model identity.

## Source and coordination

Branch: `karen/agent-monitoring-design-20261008`, PR #466. The original design/history remains in `HANDOFF-AI-AGENT-MONITORING.md`.

Session `karen22.1` was registered; no create-task tool was exposed, so no Agent Bus claim/report was fabricated. Existing task claims were read before work. No task belonging to another agent was changed. This uses the documented GitHub-only implementation path. Karen remains implementer; handoff to Hana is only for a proved access-specific blocker, if needed.

## DOC-IMPACT

REQUIRED — records delivered behavior, test evidence, design deltas, and the exact boundary between working local prototype and unverified user-laptop integration.
