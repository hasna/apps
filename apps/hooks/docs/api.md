# @hasna/hooks — API Reference

> **Status: implemented.** This document describes the hooks registry API as
> merged on main: the local server (`hooks serve`, src/serve.ts) and the
> Cloudflare Worker (src/cf/worker.ts) expose the same surface.

The API is served by `hooks serve` locally (default port 39428, bind
127.0.0.1) and deployed to Cloudflare Workers. All paths are relative to the
configured API base URL.

## 1. Conventions

- **Content type:** `application/json` for both requests and responses.
- **Auth:** every read is **unauthenticated** — `GET /health`, `GET
  /api/v1/catalog`, `GET /api/v1/lock`, and `GET /api/v1/hooks/:name/:version`
  require no key. Only `PUT /api/v1/hooks` (publish) requires the API key, via
  the `X-API-Key` header or `Authorization: Bearer <key>`; a missing or
  invalid key returns `401`.
- **Digests:** artifact responses carry the bundle sha256 in the
  `x-hook-sha256` header (lowercase, as implemented in serve.ts and
  worker.ts), hex-encoded (64 lowercase hex characters).
- **Errors:** every error response is a JSON object `{"error": "<message>"}`
  with an appropriate HTTP status (see §5).
- **Versioning:** `:version` is an exact semver (`1.4.0`). Ranges are resolved
  client-side, never server-side.

## 2. Routes

### 2.1 `GET /health`

Liveness probe. No auth.

**200**

```json
{ "status": "ok", "name": "hooks-registry" }
```

### 2.2 `GET /api/v1/catalog`

Returns the catalog: one entry per hook, for its current version. No auth.

**200**

```json
{
  "hooks": [
    {
      "name": "pre-bash",
      "version": "0.1.0",
      "sha256": "9f2c…",
      "events": ["PreToolUse"],
      "description": "Codewith Bash gate for staged secrets scans before commit/push and comms rechecks before risky operations",
      "source": "bundled"
    }
  ]
}
```

`source` is `bundled` or `custom` on the local server (`custom-overrides-bundled`
when a custom hook shadows a bundled one); on the Worker it is the row's
`source_type` (`remote` for published hooks).

### 2.3 `GET /api/v1/hooks/:name/:version`

Returns one artifact envelope. No auth. The bundle sha256 is in the
`x-hook-sha256` header; the body carries the manifest plus the script payload.

**200**

```
x-hook-sha256: 9f2c…(64 hex chars)
```

```json
{
  "manifest": {
    "name": "pre-bash",
    "version": "0.1.0",
    "description": "…",
    "events": ["PreToolUse"],
    "script": "src/hook.ts"
  },
  "script": "…(script payload)…"
}
```

The `x-hook-sha256` header is the digest of the script bytes (on the local
server, the sha256 of the resolved script file). The body does not repeat it;
a client verifies the script it received against the header and fails closed
on mismatch.

**404** — no such hook or version:

```json
{ "error": "Hook 'pre-bash@1.4.0' not found locally" }
```

### 2.4 `PUT /api/v1/hooks`

Publishes a hook. The only authenticated route. The two implementations take
different request bodies:

- **`hooks serve` (local):** the body names a hook that already exists in the
  local store; the server re-pins it (`retrustHook` updates both the SQLite
  record and `hooks.lock` in one write path).

  ```json
  { "name": "pre-bash", "version": "0.1.0" }
  ```

  - `404` if the hook is not in the local store.
  - `409` if the requested `version` differs from the local version.
  - `400` if the body is not valid JSON.

- **Worker (remote):** the body is a full artifact; the server computes the
  sha256 of the script, writes it to R2 at `hook_artifacts/<name>/<version>.json`
  and upserts the D1 row. Re-publishing the same `name@version` **overwrites
  unconditionally** — there is no digest-collision rejection.

  ```json
  {
    "manifest": {
      "name": "ci-guard",
      "version": "1.0.0",
      "description": "Block commits that skip CI checks",
      "events": ["PreToolUse", "Stop"],
      "script": "guard.sh"
    },
    "script": "…"
  }
  ```

  - `400` if `manifest.name`, `manifest.version`, or `script` is missing.
  - `401` if the API key is missing or invalid.

**200** (both implementations):

```json
{ "ok": true, "hook": { "name": "ci-guard", "version": "1.0.0", "sha256": "9f2c…" } }
```

### 2.5 `GET /api/v1/lock`

Returns the server-side lock state — the mirror of the client `hooks.lock`
file. No auth.

**200**

```json
{
  "hooks": {
    "pre-bash": { "version": "0.1.0", "sha256": "9f2c…", "source": "bundled" }
  }
}
```

There is no `PUT /api/v1/lock`: the lock is derived from the store, never
published.

## 3. Authentication

- Only `PUT /api/v1/hooks` requires a key.
- The key is accepted via `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- On the local server the key comes from `--api-key`, `HASNA_HOOKS_API_KEY`,
  or `HOOKS_API_KEY`; on the Worker it is the `HOOKS_API_KEY` secret binding.
- Missing or invalid key → `401 {"error": "unauthorized: valid API key
  required to publish"}`.

## 4. Headers summary

| header | where | meaning |
|---|---|---|
| `X-API-Key` | `PUT /api/v1/hooks` only | publish key (`Authorization: Bearer` also accepted) |
| `x-hook-sha256` | artifact GET response | bundle digest, 64 hex chars |

## 5. Error codes

| status | meaning |
|---|---|
| `400` | invalid JSON body, or worker publish body missing `manifest`/`script` |
| `401` | missing or invalid API key on `PUT /api/v1/hooks` |
| `404` | unknown route, hook, or version |
| `409` | `hooks serve` publish: requested version differs from the local version |
| `500` | server error (D1/R2 failure); retryable |

Every error body is `{"error": "<message>"}`.

## 6. Client behaviour notes

- `hooks sync` fetches catalog and lock, then verifies each artifact's script
  sha256 against the lock entry before installing; a mismatch aborts the sync
  (fail-closed).
- `hooks sync` treats a non-`2xx` as a failed pass: nothing local changes.
- The catalog and artifact GETs are cacheable; the publish PUT is the only
  write.
