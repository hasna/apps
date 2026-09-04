# HTTP API

Start the combined server with:

```bash
repos-serve
REPOS_PORT=20000 repos-serve
```

The default port is `19450`. The executable has no `--port` flag; use
`REPOS_PORT`. It starts the auto-index worker, answers API routes, and
mounts both REST and MCP routes.

## REST endpoints

All REST responses are JSON. Repository and remote fields pass through the
remote-output sanitizer before serialization.

| Method and path | Query/body | Result |
|---|---|---|
| `GET /api/repos` | `org`, `query`, `limit` (50), `offset` (0) | Repository list |
| `GET /api/repos/:id` | `:id` may be a numeric ID, exact path, or exact/unique name | Repo record merged with repo stats; 404 if absent |
| `GET /api/search/repos` | `query`, `limit` (20) | Repository full-text matches |
| `GET /api/commits` | `repo_id`, `author`, `since`, `until`, `limit` (50), `offset` (0) | Commit list |
| `GET /api/search/commits` | `query`, `limit` (20) | Commit full-text matches |
| `GET /api/branches` | `repo_id`, `limit` (100) | Branch list |
| `GET /api/tags` | `repo_id`, `limit` (100) | Tag list |
| `GET /api/prs` | `repo_id`, `state`, `author`, `limit` (50) | Pull request list |
| `GET /api/search` | `query`, `limit` (20) | Unified repo, commit, and PR matches |
| `GET /api/stats` | None | Global totals and summary arrays |
| `GET /api/health` | None | Dirty, unpushed, behind, and stale checkout report |
| `POST /api/scan` | Optional JSON `{ "roots": ["..."], "full": true }` | Forced bootstrap scan plus hook-install counts |

The API does not expose every CLI filter. In particular, REST PR listing does
not accept `org`, `repo_name`, `duplicates`, or pagination offsets; use the CLI,
SDK, or MCP tool when those controls are required.

`POST /api/scan` returns the scan/hook summary after the forced scan completes.

## MCP and service health

The combined server mounts the stateless Streamable HTTP MCP transport at
`/mcp`. `GET /health` is the MCP service liveness response:

```json
{ "status": "ok", "name": "repos" }
```

Workspace checkout health is the separate `GET /api/health` route.

## Bind and CORS

The server binds `127.0.0.1` by default (`REPOS_HOST` overrides). API JSON
responses carry no `Access-Control-Allow-*` headers, so cross-origin browsers
cannot read them; `OPTIONS` receives an empty `204` preflight response. When
`REPOS_SERVE_TOKEN` is set, every route requires `Authorization: Bearer
<token>`, and a non-loopback `REPOS_HOST` refuses to start without the token.
On a loopback bind, every route validates the `Host` header against the
server's own addresses (`127.0.0.1`, `localhost`, `[::1]` with the port) —
DNS-rebinding protection, `/api` included, not only `/mcp`; a request
carrying any other `Host` is rejected with `403`. The `/mcp` endpoint
additionally enforces the same allowlist inside the SDK transport, and
`REPOS_MCP_ALLOWED_ORIGINS` optionally restricts `Origin` as well.

There is no browser dashboard. Unknown non-API paths — including any static
asset path — return the JSON 404 below; only API routes answer.
