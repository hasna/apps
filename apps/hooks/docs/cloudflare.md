# @hasna/hooks — Cloudflare Operator Guide

> **Status: implemented.** This guide describes `hooks cf deploy` and the
> Cloudflare Worker as merged on main (src/cf/provision.ts,
> src/cf/worker.ts).

This guide is for operators running the optional Cloudflare registry for
`@hasna/hooks`: a Workers API, a D1 catalog database, and an R2 artifact
store. The backend is opt-in. Without it, the client is fully local and
nothing in this document applies.

## 1. Prerequisites

- A Cloudflare account.
- A Cloudflare API token with permissions to manage D1 databases and R2
  buckets (the token must cover the account you provision into).
- The token available **only via the environment** (see §6) — never in a
  config file, a manifest, a transcript, or a commit.
- Your Cloudflare account id.
- `wrangler` installed and logged in (for the upload steps printed by
  `hooks cf deploy`).

## 2. Initializing the client for the remote registry

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
`hooks sync` operate against the remote registry while the API URL is
configured.

## 3. Deploying the backend

```bash
hooks cf deploy
```

`hooks cf deploy` provisions the Cloudflare resources through the Cloudflare
API:

1. Creates (or finds) the D1 database.
2. Creates (or finds) the R2 bucket.
3. Prints the exact `wrangler` commands for the operator to run:

   ```bash
   wrangler d1 migrations apply <database-name> --remote
   wrangler secret put HOOKS_API_KEY
   wrangler deploy --config wrangler.toml
   ```

**`hooks cf deploy` does not upload the worker.** The worker needs the
workerd target, which only wrangler can bundle; the command prints the
commands instead of shipping a token-bearing upload path. Copy
`src/cf/wrangler.toml.example` to `wrangler.toml`, fill in the D1 database id
and the account/worker fields, then run the printed commands.

The `--dry-run` flag prints the plan without calling the Cloudflare API.
`--account-id`, `--database-name`, and `--bucket-name` override the defaults
(`CF_ACCOUNT_ID`, `hooks-registry`, `hooks-registry-artifacts`).

After the worker is live, verify:

```bash
curl -sS <api-url>/health
```

which must return `200` with the JSON body `{"status":"ok","name":"hooks-registry"}`.

## 4. Serving artifacts

Once deployed, the API serves:

- `GET /health` — liveness (no auth).
- `GET /api/v1/catalog` — the catalog (no auth).
- `GET /api/v1/hooks/:name/:version` — one artifact envelope with the
  `x-hook-sha256` header (no auth).
- `GET /api/v1/lock` — server-side lock state (no auth).
- `PUT /api/v1/hooks` — publish (auth).

R2 stores artifacts at:

```
hook_artifacts/<name>/<version>.json
```

The key embeds name and version. Re-publishing the same `name@version`
**overwrites** the object unconditionally — there is no digest-collision
rejection at publish time. Integrity is enforced at consumption: `hooks sync`
verifies each artifact's script against the lock entry before installing, and
the run-time trust check enforces the pin. Full wire contract:
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

- **D1** — free tier covers the catalog table at typical hook counts
  (hundreds of rows, low write rate). Writes are small: one row per
  published hook/version.
- **R2** — free tier covers artifact storage: objects are small (a manifest
  plus a script, typically a few KB). Each hook version costs one object.
- **Workers** — catalog/artifact GETs are cacheable and the API is
  read-mostly; publish PUTs are rare.

Monitor usage via the Cloudflare dashboard. If a large fleet pushes traffic
out of the free tiers, the API's read paths are cache-friendly — the first
cheap optimisation is Cloudflare's cache on `/api/v1/catalog` and
`/api/v1/hooks/:name/:version`.

## 8. Troubleshooting

| symptom | check |
|---|---|
| `sync` fails closed, API unreachable | `curl -sS <api-url>/health`; token/account scope; worker deployed? |
| `401 Unauthorized` on `PUT /api/v1/hooks` | key name resolution failed or wrong key; re-check `--api-key` reference and env; `wrangler secret put HOOKS_API_KEY` run? |
| published artifact differs from what you uploaded | re-publishing the same `name@version` overwrites silently — bump the version to keep history |
| worker 500 on catalog | D1 binding missing or wrong `--bindings` in the printed wrangler command |
| artifacts 404 but catalog lists them | R2 binding wrong, or the object key differs from `hook_artifacts/<name>/<version>.json` |
