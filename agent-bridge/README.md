# Agent Bridge — read-only GitHub access for claude.ai

A standalone Cloudflare Worker that speaks [MCP](https://modelcontextprotocol.io)
over Streamable HTTP, so a chat client such as claude.ai can **read** this
repository through a custom connector.

It exists because the claude.ai connector directory has no GitHub entry. Rather
than wait for one, this bridge publishes the read surface we actually need.

## What it is not

This Worker is **not** part of the Prototype Leker application. It has no D1
binding, shares no code with `src/`, and is deployed as a separate Worker. The
production Worker `prototype-leker-v2` runs a real accounting system with strict
posting and isolation boundaries; a GitHub bridge does not belong inside it.

## Read-only by construction

The guarantee is structural, not a matter of policy or prompt wording:

- the GitHub client hard-codes `method: 'GET'` — the verb is never taken from input;
- request paths are always composed against `https://api.github.com`, so a caller
  cannot steer the client at another host;
- every repository-scoped call passes the `ALLOWED_REPOS` allowlist **before** any
  network call;
- code search appends the `repo:` qualifier itself, so a crafted query cannot
  widen the search past the allowlist;
- the tool surface is a fixed list of eleven read tools with no generic
  "call this endpoint" escape hatch.

Even if the connector is compromised or misused, the worst it can do is read the
repositories named in `ALLOWED_REPOS`.

## Tools

| Tool | Purpose |
|---|---|
| `github_get_file` | Read one file at an optional ref |
| `github_list_directory` | List a directory |
| `github_search_code` | Search code within the repo |
| `github_list_pull_requests` | List PRs |
| `github_get_pull_request` | One PR, optionally with its diff |
| `github_list_issues` | List issues |
| `github_get_issue` | One issue with its comment thread |
| `github_list_commits` | Commit history, optionally per file |
| `github_get_commit` | One commit summary or diff |
| `github_list_branches` | List branches |
| `github_list_workflow_runs` | Recent CI runs and their conclusions |

## Deploy

Two secrets are required. Neither is ever committed.

**1. Create a GitHub fine-grained personal access token**

Scope it to `cyo-ramadan/prototype-leker` only, with **read-only** permissions:
Metadata, Contents, Issues, Pull requests, Actions. Grant nothing writable — the
bridge has no code path that would use it.

**2. Generate a bridge token** (this is what authenticates claude.ai to the bridge):

```sh
openssl rand -hex 32
```

**3. Deploy and set both secrets**

```sh
npx wrangler deploy --config agent-bridge/wrangler.jsonc
npx wrangler secret put GITHUB_TOKEN   --config agent-bridge/wrangler.jsonc
npx wrangler secret put MCP_AUTH_TOKEN --config agent-bridge/wrangler.jsonc
```

## Connect claude.ai

In claude.ai → **Settings → Connectors → Add custom connector**, use:

```
https://leker-agent-bridge.<your-subdomain>.workers.dev/mcp
```

Supply the bridge token as a bearer token if the connector form accepts custom
headers. If it does not, put the token in the URL instead — the bridge accepts it
as the final path segment:

```
https://leker-agent-bridge.<your-subdomain>.workers.dev/mcp/<MCP_AUTH_TOKEN>
```

Treat that URL as a credential: anyone holding it can read the allowlisted repos.

## Verify

```sh
# Unauthenticated requests must be refused.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/mcp   # expect 401

# Authenticated tool listing.
curl -s -X POST https://<host>/mcp \
  -H "authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -40
```

## Tests

Covered by the repository suite (`npm test`) — the bridge tests run offline
against a stubbed `fetch`, and assert the allowlist, the GET-only invariant, the
search-qualifier pinning, and the endpoint's auth behaviour.

```sh
node --test agent-bridge/test/agent-bridge.test.js
```
