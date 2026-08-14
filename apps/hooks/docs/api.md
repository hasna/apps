# @hasna/hooks — API Reference

> **Status: implementation in progress — lane L1 (PR pending). These docs describe the target state.**

The API is served by `hooks serve` locally and deployed to Cloudflare Workers
via `hooks cf deploy`. All paths are relative to the configured API base URL.

## 1. Conventions

- **Content type:** `application/json` for both requests and responses.
- **Auth:** every route except `GET /health` requires the header
  `X-API-Key: <key>`. Requests without it (or with an invalid key) return
  `401`.
- **Digests:** artifact responses carry the bundle sha256 in the
  `X-Hooks-Sha256` header, hex-encoded (64 lowercase hex characters).
- **Errors:** every error response is a JSON object `{"error": "<message>"}`
  with an appropriate HTTP status (see §5).
- **Versioning:** `:version` is an exact semver (`1.4.0`). Ranges are
  resolved client-side, never server-side.

## 2. Routes

### 2.1 `GET /health`

Liveness probe. No auth.

**200**

```json
{ "ok": true, "service": "hooks-api" }
```

### 2.2 `GET /api/v1/catalog`

Returns the full catalog: every hook, every version, and its digest.

**200**

```json
{
  "hooks": [
    {
      "name": "pre-bash",
      "versions": [
        { "version": "1.4.0", "sha256": "9f2c…" }
      ],
      "description": "PreToolUse Bash gate for staged secrets scans",
      "events": ["PreToolUse"]
    }
  ]
}
```

### 2.3 `GET /api/v1/hooks/:name/:version`

Returns one artifact envelope. The bundle sha256 is in the
`X-Hooks-Sha256` header; the body carries the manifest plus the script
payload.

**200**

```
X-Hooks-Sha256: 9f2c…(64 hex chars)
```

```json
{
  "name": "pre-bash",
  "version": "1.4.0",
  "description": "PreToolUse Bash gate for staged secrets scans",
  "events": ["PreToolUse"],
  "script": "…(script payload)…",
  "sha256": "9f2c…"
}
```

The `sha256` field in the body must equal the `X-Hooks-Sha256` header; a
client that sees a mismatch discards the response and fails closed.

**404** — no such hook or version:

```json
{ "error": "hook pre-bash@1.4.0 not found" }
```

### 2.4 `PUT /api/v1/hooks`

Publishes a hook. Auth required.

**Request** (body as in §2.3, plus the header):

```
X-API-Key: <key>
X-Hooks-Sha256: 9f2c…
```

```json
{
  "name": "ci-guard",
  "version": "1.0.0",
  "description": "Block commits that skip CI checks",
  "events": ["PreToolUse", "Stop"],
  "script": "…"
}
```

Semantics:

- The manifest is validated (name, semver, events, script).
- `X-Hooks-Sha256` must match the sha256 of the received bundle; a mismatch
  returns `400`.
- Collision rule: `name@version` already stored **with a different digest**
  → `409 Conflict`. Same digest → idempotent success (`200`, no new object).

**200**

```json
{ "ok": true, "name": "ci-guard", "version": "1.0.0", "sha256": "9f2c…" }
```

### 2.5 `GET /api/v1/lock`

Returns the server-side lock state (the mirror of `hooks.lock`).

**200**

```json
{
  "lock": [
    { "name": "pre-bash", "version": "1.4.0", "sha256": "9f2c…" }
  ]
}
```

### 2.6 `PUT /api/v1/lock`

Publishes a lock state. Auth required. Each entry must resolve to an
existing artifact; an entry whose `name@version` or `sha256` does not match
the catalog returns `400`.

**Request**

```
X-API-Key: <key>
```

```json
{
  "lock": [
    { "name": "pre-bash", "version": "1.4.0", "sha256": "9f2c…" }
  ]
}
```

**200**

```json
{ "ok": true, "count": 1 }
```

## 3. Authentication

- Header: `X-API-Key: <key>`.
- The key value comes from the environment (`HOOKS_API_KEY`) or the resolved
  secrets reference — never from config, never from a recorded command line.
- Invalid or missing key → `401 {"error": "unauthorized"}`.

## 4. Headers summary

| header | where | meaning |
|---|---|---|
| `X-API-Key` | all routes except `/health` | bearer key |
| `X-Hooks-Sha256` | artifact GET / publish PUT | bundle digest, 64 hex chars |

## 5. Error codes

| status | meaning |
|---|---|
| `400` | malformed body, invalid manifest, digest/body mismatch |
| `401` | missing or invalid `X-API-Key` |
| `404` | unknown route, hook, or version |
| `409` | publish collision: same `name@version`, different digest |
| `500` | server error (D1/R2 failure); retryable |

Every error body is `{"error": "<message>"}`.

## 6. Client behaviour notes

- The client verifies the `X-Hooks-Sha256` header on every artifact fetch and
  refuses to install on mismatch.
- `hooks sync` treats a non-`2xx` as a failed pass: nothing local changes
  (fail-closed).
- The catalog and artifact GETs are cacheable; PUT routes are not.
