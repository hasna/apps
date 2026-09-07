# hooks registry on Cloudflare (D1 + R2 + Worker)

The `hooks cf` command provisions the Cloudflare-side registry: a D1 database
for hook rows, an R2 bucket for artifacts, and prints the wrangler commands
to deploy the Worker (`src/cf/worker.ts`). Worker upload itself is performed
by wrangler, never by the CLI — the worker needs the workerd target, which
only wrangler can bundle.

## Provisioning

```
hooks cf deploy                 # create D1 + R2 via the Cloudflare API
```

Then, from `src/cf/`:

```
wrangler d1 migrations apply <database-name> --remote
wrangler secret put HOOKS_API_KEY
wrangler deploy --config wrangler.toml
```

`HOOKS_API_KEY` is an encrypted secret, never a `[vars]` entry. Copy
`wrangler.toml.example` to `wrangler.toml` and fill in the D1 database id.

## API key and the privacy lock-down

When the `HOOKS_API_KEY` binding is set, the Worker requires the key on every
route except `GET /health` (which stays open for probes). That includes the
catalog, artifact and lock reads — a configured registry is private, not
read-public.

```
curl -H "X-API-Key: <key>" https://<worker-url>/api/v1/catalog
```

Without the binding, reads stay open — the OSS default. Publish
(`PUT /api/v1/hooks`) requires the key in both configurations. Keys are
compared with a constant-time compare.

## The sync client

`hooks sync` talks to the Worker when the @hasna/contracts chain resolves a
registry URL and key together (hasna/apps#1720 — `HASNA_HOOKS_API_URL`, the
Keychain item `hasna.credentials.hooks.api-url`, or
`~/.hasna/hooks/config/credentials`; the unprefixed `HOOKS_API_URL` survives
only as the resolver's silent alias). When the registry requires a key,
deliver it through the vault and let `secrets exec` place it in the
environment — the client never stores the value:

```
secrets exec <org>/<name>/<key> --as HASNA_HOOKS_API_KEY -- \
  hooks sync
```

The client sends `X-API-Key` (the key resolved with the authority it is being
sent to) on every registry request. A `401` response fails the sync with:

```
registry requires API key — set HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials (resolved per call, never stored)
```

## Storage layout

- D1: a single `hooks` table (`id, name, version, sha256, source_type,
  source_ref, installed_at, enabled, last_verified_at`).
- R2: artifacts under `hook_artifacts/<name>/<version>.json` — the manifest
  envelope plus the script.
- The lock endpoint derives its pin map from the D1 rows.
