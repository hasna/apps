# @hasna/hooks — Cloudflare Operator Guide

> **Status: implementation in progress — lane L1 (PR pending). These docs describe the target state.**

This guide is for operators running the optional Cloudflare backend for
`@hasna/hooks`: a Workers API, a D1 catalog/lock database, and an R2
immutable artifact store. The backend is opt-in. Without it, the client is
fully local and nothing in this document applies.

## 1. Prerequisites

- A Cloudflare account.
- A Cloudflare API token with permissions to manage Workers, D1 databases,
  and R2 buckets (the token must cover the zone/account you deploy to).
- The token available **only via the environment** (see §6) — never in a
  config file, a manifest, a transcript, or a commit.
- Your Cloudflare account id.
- `wrangler` installed and logged in (for the upload step printed by
  `hooks cf deploy`).

## 2. Initializing the client for the remote backend

```bash
hooks init --cloudflare \
  --api-url https://hooks.<your-account>.workers.dev \
  --api-key <key-name-reference>
```

- `--api-url` is the base URL of the deployed Workers API. The client stores
  this in `config.json` (`api_url`) — or it can be supplied per-run via the
  `HASNA_HOOKS_API_URL` environment variable, which takes precedence.
- `--api-key <key-name-reference>` is the **name** of a key, not the key
  value. The client resolves the value through the environment or the Hasna
  secrets CLI at the moment it is needed, and `config.json` stores only the
  name. See §6.

After init, `hooks list`, `hooks search`, `hooks install <name>`, and
`hooks sync` operate against the remote backend while the API URL is
configured.

## 3. Deploying the backend

```bash
hooks cf deploy
```

`hooks cf deploy` performs the provisioning steps:

1. Creates (or reconciles) the D1 database — including applying the D1
   schema, which is the parity mirror of the SQLite schema (see
   `docs/architecture.md` §5).
2. Creates (or reconciles) the R2 bucket.
3. Builds the worker bundle with the fixed bindings:

   ```
   HOOKS_D1   D1 database binding
   HOOKS_R2   R2 bucket binding
   ```

4. Prints the exact `wrangler` upload command for the worker, for example:

   ```bash
   wrangler deploy --name hooks-api \
     --bindings D1:HOOKS_D1=<db-id> R2:HOOKS_R2=<bucket-name>
   ```

   Run the printed command (or, when the Cloudflare CLI is available and
   authenticated, `hooks cf deploy` runs it for you). After the worker is
   live, verify:

   ```bash
   curl -sS <api-url>/health
   ```

   which must return `200 OK` with a JSON body.

## 4. Serving artifacts

Once deployed, the API serves:

- `GET /api/v1/catalog` — the catalog (no auth).
- `GET /api/v1/hooks/:name/:version` — one artifact envelope with the
  `X-Hooks-Sha256` header (no auth).
- `PUT /api/v1/hooks` — publish (auth).
- `GET|PUT /api/v1/lock` — lock state (auth).

R2 stores artifacts immutably at:

```
hook_artifacts/<name>/<version>.json
```

The key embeds name and version; the envelope embeds the digest. A collision
with a different digest is rejected at the API. Full wire contract:
`docs/api.md`.

## 5. Syncing machines

On every machine that should use the unified hook set:

```bash
hooks init --cloudflare --api-url <url> --api-key <key-name-ref>
hooks sync
```

`hooks sync` pulls the catalog and lock state, verifies every artifact's
sha256 before installing, and fails closed when the API is unreachable (no
partial apply). `--dry-run` previews the plan. Local-only hooks are never
deleted by a sync. See `docs/versioning.md` §6 for multi-machine consistency
behaviour.

## 6. Secrets hygiene

The API key is a credential. The rules:

1. **Only the environment carries the value.** Resolve it with
   `secrets exec <key> --as HOOKS_API_KEY -- <command>` or set it for the
   process — never write the value into `config.json`, a shell history, a
   task comment, a transcript, or a commit.
2. **`config.json` stores the key name only.** `--api-key <name>` writes a
   reference; the CLI resolves the name through the environment variable
   `HOOKS_API_KEY` or the configured secrets provider at call time.
3. **Never print or log the value.** If you need to verify presence, test
   whether the variable is set (`[ -n "$HOOKS_API_KEY" ] && echo set`) or use
   `secrets get <key> --check` — both emit no value.
4. **`curl` against the API** uses the same discipline: pass the header from
   the environment (`-H "X-API-Key: $HOOKS_API_KEY"`), never an inline
   literal in a recorded command line.

A leaked key value is reported to the `incidents` channel by name and scope,
never rotated piecemeal.

## 7. Cost notes

The backend is designed to sit inside Cloudflare's free tiers for normal
scale:

- **D1** — free tier covers the catalog and lock tables at typical hook
  counts (hundreds of rows, low write rate). Writes are small: one row per
  published hook/version and per lock state.
- **R2** — free tier covers artifact storage: objects are small (a manifest
  plus a script, typically a few KB) and immutable, so no churn. Each hook
  version costs one object forever.
- **Workers** — catalog/artifact GETs are cacheable and the API is
  read-mostly; publish and lock PUTs are rare.

Monitor usage via the Cloudflare dashboard. If a large fleet pushes traffic
out of the free tiers, the API's read paths are cache-friendly — the first
cheap optimisation is Cloudflare's cache on `/api/v1/catalog` and
`/api/v1/hooks/:name/:version`.

## 8. Troubleshooting

| symptom | check |
|---|---|
| `sync` fails closed, API unreachable | `curl -sS <api-url>/health`; token/account scope; worker deployed? |
| `401 Unauthorized` on PUT routes | key name resolution failed or wrong key; re-check `--api-key` reference and env |
| publish rejected with collision error | that `name@version` already exists with a different digest — bump the version |
| worker 500 on catalog | D1 binding missing or wrong `--bindings` in the printed wrangler command |
| artifacts 404 but catalog lists them | R2 binding wrong, or the object key differs from `hook_artifacts/<name>/<version>.json` |
