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
