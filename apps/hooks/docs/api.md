# hooks registry HTTP API

`hooks serve` exposes the local registry as an HTTP API on
`http://127.0.0.1:39428` by default. The Cloudflare Worker
(`src/cf/worker.ts`) exposes the same surface. All responses are JSON.

## Authentication

The API key is checked with a constant-time compare; no key material is
logged.

**Publishing** (`PUT /api/v1/hooks`) always requires the API key, on both
`hooks serve` and the Worker.

**Reads** (`GET catalog`, `GET artifact`, `GET lock`) follow the registry's
configuration:

- When a key is configured, reads require it too. The Worker gates every
  route except `/health` whenever the `HOOKS_API_KEY` binding is set; the
  local `hooks serve` registry is bound to `127.0.0.1` and keeps reads open
  unless you restrict access at the network layer.
- Without a configured key, reads stay open — that is the OSS default.

Send the key as an `X-API-Key` header:

```
curl -H "X-API-Key: <key>" http://127.0.0.1:39428/api/v1/catalog
```

`Authorization: Bearer <key>` is accepted as an alternative. A missing or
wrong key returns `401 {"error":"unauthorized: valid API key required"}`.

## Routes

### GET /health

Open to unauthenticated probes (load balancers, uptime checks) whether or
not a key is configured.

```json
{"status":"ok","name":"hooks-registry"}
```

### GET /api/v1/catalog

Lists every enabled hook in the registry.

```json
{
  "hooks": [
    {"name":"gitguard","version":"0.1.0","sha256":"<hex>","events":["PreToolUse"],"description":"...","source":"bundled"}
  ]
}
```

### GET /api/v1/hooks/:name/:version

Returns one artifact: the manifest plus the raw script. The response carries
the artifact hash in the `x-hook-sha256` header; the client verifies the
script bytes against that hash and against the lock before installing.

```json
{
  "manifest": {"name":"gitguard","version":"0.1.0","description":"...","events":["PreToolUse"],"script":"src/hook.ts"},
  "script": "#!/usr/bin/env bun\n..."
}
```

Unknown name or version: `404 {"error":"Hook '<name>@<version>' not found"}`.

### GET /api/v1/lock

Returns the registry lock — the pin file the sync client reconciles against.
Shape matches `~/.hasna/hooks/hooks.lock`.

```json
{
  "hooks": {
    "gitguard": {"version":"0.1.0","sha256":"<hex>","source":"bundled"}
  }
}
```

### PUT /api/v1/hooks

Publishes the current local version of a hook. Requires the API key on every
registry.

- Worker: body is `{manifest:{name,version,...}, script}`; the worker stores
  the artifact in R2 and upserts the D1 row.
- `hooks serve`: body is `{name, version?}`; the server re-trusts the local
  hook and updates the lock and the SQLite record in one path.

Responses:

- `200 {"ok":true,"hook":{"name":"...","version":"...","sha256":"<hex>"}}`
- `401` missing/wrong key
- `404 {"error":"Hook '<name>' not found in local store"}`
- `409 {"error":"Version mismatch: ..."}` when the requested version differs

## Hook events

Hook events — one row per hook execution — live on the registry, not in a
file on the machine that fired them. `hooks run`, the SDK `runHook`, the MCP
run tools and the bundled observability hooks POST them; `hooks log` and the
`hooks_log_*` MCP tools read them back. The on-box SQLite store answers only
under the deliberate `HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`) opt-in.

Every route below requires the API key (there is no open-read default for a
caller's own events), and every one answers `503` when the server has no
event store configured (`HASNA_HOOKS_DATABASE_URL`). A `503` is deliberate:
an empty list would read as "you have no events" to a caller whose events
simply live somewhere else.

### POST /api/v1/events

Body is one event object, an array of them, or `{events:[...]}` — at most 100
per request. Required fields: `session_id`, `hook_name`, `event_type` (one of
`PreToolUse`, `PostToolUse`, `Stop`, `Notification`, `SessionStart`,
`SessionEnd`, `UserPromptSubmit`, `SubagentStart`). Optional: `tool_name`,
`tool_input`, `result` (`continue`/`block`), `error`, `duration_ms`,
`project_dir`, `metadata`, `timestamp`. The server assigns `id` and
`timestamp` when the writer omits them.

- `201 {"events":[{...}],"count":1}`
- `400` invalid payload (unknown `event_type`, missing `session_id`, ...)

Clients redact and truncate `tool_input` / `error` / `metadata` before
sending, the same projection the local writer applied.

### GET /api/v1/events

Query parameters: `hook` (exact name), `session` (prefix), `since` (ISO
timestamp or a duration like `30m`, `2h`, `7d`), `q` (substring of
`tool_input` or `error`), `errors_only`, `limit` (max 500). Rows come back
newest first.

- `200 {"events":[{...}],"count":N}`

### DELETE /api/v1/events

Optional `hook` query parameter deletes only that hook's events.

- `200 {"deleted":N}`

### GET /api/v1/events/summary

Optional `since`. Returns per-hook totals and error rates.

- `200 {"since":"...","hooks":[{"hook_name":"...","total":N,"errors":N,"error_rate":"0.0%"}],"totals":{"events":N,"errors":N,"hooks_active":N}}`

### POST /api/v1/feedback

Body `{message, email?, category?, version?}`.

- `201 {"ok":true,"id":"<id>"}`
- `400` missing message
