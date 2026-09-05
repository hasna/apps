# Hosted auth runbook — `/api/*` and `/mcp` fail closed

Applies from `@hasna/todos` **0.13.0**. Read this before redeploying a hosted
deployment or upgrading a machine that runs `todos serve` / `todos-mcp --http`.

> **Server credential naming (2026-09-05).** The env var that configures this
> static credential is `HASNA_TODOS_SERVER_API_KEY` — the server's own
> variable, separate from the client credential names. The older
> `TODOS_API_KEY` references below mean the same credential; `TODOS_API_KEY`
> and the client name `HASNA_TODOS_API_KEY` are accepted as a documented
> one-release fallback so existing secret mappings and exports keep working,
> while `todos serve` prints one line at startup naming the variable that
> actually supplied its accepted key.

## What changed

`checkAuth` used to fail **open**: with no `TODOS_API_KEY` and no stored API key it
returned "authorized" for every request. On a deployment that binds a non-loopback
host (`--host 0.0.0.0` behind a load balancer) that published, to any anonymous
caller:

- `POST /mcp` — the full MCP tool catalog and `tools/call` (create/start/complete/fail
  task, register agent, findings, run transactions),
- every `/api/*` REST route — task/project/agent/plan/org/template/webhook CRUD,
  `/api/doctor` (internal database path), `/api/headless` (boundary manifest), and the
  unbounded SSE streams `/api/events` and `/api/tasks/stream`.

The unconfigured case now **denies**. The posture is resolved once at startup
(`src/server/auth-posture.ts`):

| Configuration | Posture | `/api/*` + `/mcp` | `/v1` | `/health` `/ready` `/version` `/openapi.json` |
| --- | --- | --- | --- | --- |
| `HASNA_TODOS_SERVER_API_KEY` set, or ≥1 stored key | `enforce` | credential required | authenticated | public |
| a remote database URL is configured, no local key | `local-plane-disabled` | `404 LOCAL_PLANE_DISABLED` | authenticated | public |
| loopback bind + explicit `--allow-anonymous` | `anonymous-loopback` | anonymous, loopback peers only | authenticated | public |
| anything else | **refuses to start** (exit 1) | — | — | — |

`--allow-anonymous` / `TODOS_ALLOW_ANONYMOUS=1` is **refused** for any non-loopback
bind host, and even when active a request is only served anonymously if its raw
transport peer address is loopback (the check deliberately ignores
`x-forwarded-for`, so `TODOS_TRUST_PROXY=1` cannot be used to spoof a loopback peer).

## Hosted deployment — deploy steps

A hosted deployment normally configures a remote database URL and the API-key signing
secret, and does **not** set `HASNA_TODOS_SERVER_API_KEY`. Such a deployment resolves
`local-plane-disabled` after this change:

- `/v1` keeps working unchanged — it authenticates itself against the remote API-key
  store and never used the static server credential.
- `/health` and `/ready` keep working — both are handled **before** the auth check, so
  load-balancer target-group health checks and the container `HEALTHCHECK` are
  unaffected.
- `/mcp` and `/api/*` return `404 {"code":"LOCAL_PLANE_DISABLED"}`.

**No new secret is required to close the hole.** Provision one only if you decide a
hosted deployment must keep serving `/api/*` or `/mcp`:

1. Mint a key and store it in your secret store; reference it by item name only, never
   by value.
2. Add it to the container as a **secret** reference mapped to
   `HASNA_TODOS_SERVER_API_KEY` — not as a plain environment value.
3. Roll a new revision of the service definition and deploy it.
4. Give every legitimate caller the key as `x-api-key` / `Authorization: Bearer`.

Related hardening worth applying in the same revision (pre-existing, not fixed here):

- Set `TODOS_TRUST_PROXY=1` (or key the limiter on a trusted forwarded-for header).
  Behind a proxy the limiter otherwise buckets every internet client on the proxy's
  address, so all callers share one `TODOS_RATE_LIMIT_MAX` bucket and an anonymous
  flood can `429` authenticated `/v1` traffic.
- The http transport is selected by `HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY`; the
  storage-mode variables are retired and their presence is a hard error. Client
  processes fail closed (2026-09-04 ruling, hasna/apps#1613) when the API pair is
  absent without the explicit local opt-in `HASNA_TODOS_LOCAL=1` / `TODOS_LOCAL=1`:
  a hosted image without the pair no longer routes silently to a local store, and
  cloud-routed `tools/call` invocations return an error naming the required env
  rather than an opaque failure.
  **Do not "fix" that by supplying an API URL and key while `/api/*` + `/mcp` are
  anonymous** — that wires an anonymous plane into the real datastore.
- Enable load-balancer access logs. Without them, "was this endpoint ever called?" is
  unanswerable after the fact.

## Migration for existing callers

| Caller | Before | After |
| --- | --- | --- |
| CLI / SDK against `/v1` with an API key | `/v1` with a key | unchanged — `/v1` was never affected |
| `todos-mcp` (stdio, the default for MCP clients) | local SQLite, no HTTP | unchanged |
| `todos-mcp --http` (loopback `127.0.0.1`) | anonymous | unchanged — the transport is loopback-pinned and opts in implicitly; set `HASNA_TODOS_SERVER_API_KEY` and send it from the client to enforce auth |
| `todos serve` / `todos-serve`, no key, loopback | anonymous | **breaking** — add `--allow-anonymous` (or `TODOS_ALLOW_ANONYMOUS=1`), or mint a key with `todos api-keys create "<name>"` |
| `todos serve --host 0.0.0.0`, no key | anonymous, off-box | **refuses to start** — set `HASNA_TODOS_SERVER_API_KEY` |
| Load-balancer / container health checks (`/ready`) | public | unchanged (pre-auth) |
| Hosted `/mcp`, hosted `/api/*` | anonymous | `404 LOCAL_PLANE_DISABLED` unless `HASNA_TODOS_SERVER_API_KEY` is provisioned |

Audit the callers you actually have before deploying: every MCP client entry and
automation script that drives the local stdio binary or the loopback HTTP transport is
unaffected, and every consumer that uses `/v1` is unaffected. The published
`openapi.json` declares `/v1` paths only — `/api/*` and `/mcp` were never part of the
hosted contract.

## Verify after deploying

```bash
# must be 404 (LOCAL_PLANE_DISABLED) or 401 — never 200 with a tool catalog
curl -si https://<host>/mcp -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -1
curl -si https://<host>/api/tasks | head -1
curl -si https://<host>/api/stats | head -1

# must still work
curl -si https://<host>/ready | head -1                            # 200
curl -si https://<host>/v1/tasks | head -1                         # 401 without a key
curl -si https://<host>/v1/tasks -H "x-api-key: $KEY" | head -1     # 200 with one
```
