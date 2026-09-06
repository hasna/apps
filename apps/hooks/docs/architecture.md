# @hasna/hooks — Architecture

> **Status: implemented.** This document describes `@hasna/hooks` as merged on
> main: a single hook model (bundled and custom), a dual-backend storage design
> with local as the default and a Cloudflare-backed remote registry as an
> explicit opt-in, and one versioning/trust model that works on both.

## 1. Design principles

1. **Local by default.** A fresh install works entirely offline. Nothing is
   configured, uploaded, or synced unless you opt in.
2. **One strict pair.** There are no deployment modes, no `local`/`cloud` mode
   enums, and no placement vocabulary. The only thing that selects the remote
   registry is the @hasna/contracts credential chain (hasna/apps#1720),
   resolved fresh on every call: the registry URL (`HASNA_HOOKS_API_URL`, the
   Keychain item `hasna.credentials.hooks.api-url`, or
   `~/.hasna/hooks/config/credentials`) and the key that must resolve with it
   — a URL without a key is a refusal, never half-open progress. Nothing else
   is read: `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
   `$XDG_CONFIG_HOME`, the retired `~/.hasna/hooks/config.json` key store, and
   `*_MODE` / `*_STORAGE_MODE` switches are all gone.
3. **Versions are pinned by digest.** A hook version's artifact lives at
   `name@version`; the sha256 of its script is what gets pinned, trusted, and
   verified. The digest, not a mutable pointer, is what sync and the run-time
   trust check compare against.
4. **The lockfile is the source of truth for what runs.** `hooks.lock` pins
   every installed hook to an exact version and digest. Sync, update, and the
   run-time trust check all operate on it.
5. **Trust is explicit and per-hook.** A hook whose script does not match its
   pinned digest refuses to run. `hooks trust <name>` records your acceptance
   of the current content by re-pinning its sha256 — mirroring Codewith's
   `trusted_hash` model.

## 2. The two backends

### 2.1 Local (default, zero configuration)

```
~/.hasna/hooks/
├── hooks.db             # SQLite database (owned by this package)
├── hooks.lock           # pin file: {"hooks": {"<name>": {"version","sha256","source"}}}
├── hooks/
│   └── <name>/          # custom hooks (installed by path/URL/git)
│       └── manifest.json
└── profiles/            # per-profile hook sets (existing behaviour)
```

(`config.json` — the retired `api_url` / `api_key_ref` key store — is no
longer written or read; hasna/apps#1720.)

The SQLite database (`hooks.db`) owns the hook state: the `hooks` table
(`id`, `name`, `version`, `sha256`, `source_type`, `source_ref`,
`installed_at`, `enabled`, `last_verified_at`) and the existing `hook_events`
table for event history. The schema is owned by this package and evolved
through its own migrations (see `src/db/migrations/`).

The local store serves as both catalog and artifact store. Registry installs
register the hook in the agent's settings (`hooks run <name>` entries in
`~/.claude/settings.json` or a Codewith TOML fragment) — no files are copied.
Custom installs (a local path, a git URL, or a manifest URL) write the
artifact under `~/.hasna/hooks/hooks/<name>/`. In both cases the pin (the
`hooks` table row and the `hooks.lock` entry) is written by the hook's first
run, or explicitly by `hooks sync`/`hooks update`/`hooks trust`.

### 2.2 Cloudflare registry (opt-in)

Setting `HASNA_HOOKS_API_URL` (or the Keychain item
`hasna.credentials.hooks.api-url`, or `~/.hasna/hooks/config/credentials`)
selects the remote registry, and a credential MUST resolve with it (the
@hasna/contracts strict pair, hasna/apps#1720 — a URL without a key is a
refusal). The client then talks to a Workers API that fronts:

- **D1** — the registry catalog (a `hooks` table mirroring the SQLite
  subset, see §5).
- **R2** — artifacts, stored at `hook_artifacts/<name>/<version>.json` (the
  JSON envelope contains the manifest and the script; the digest lives in the
  D1 row, not inside the envelope).

The Workers API is exercised locally with `hooks serve` and provisioned with
`hooks cf deploy`; see `docs/cloudflare.md` for the operator guide and
`docs/api.md` for the wire contract.

Nothing about the client's model changes when the registry is remote. The same
commands, the same lockfile format, the same trust rules. The backend only
changes *where* the catalog and artifacts come from and *where* the lock
state is pinned.

## 3. Hook model

Every hook — bundled or custom — is described by a manifest:

| field | type | description |
|---|---|---|
| `name` | string | unique hook name; must match `/^[\w-]+$/` (`pre-bash`, `announce-start`, …) — no slashes, so scoped names are not possible |
| `version` | string | semver (`0.1.0`) |
| `description` | string | one-line summary (optional) |
| `events` | string[] | the hook events this hook subscribes to (1+) |
| `script` | string | relative path to the executable script (or inline script) |
| `args` | string[] | optional arguments passed to the script |
| `timeout_ms` | number | optional execution timeout |

The manifest event vocabulary has eight events:

```
PreToolUse  PostToolUse  Stop  Notification  SessionStart  SessionEnd  UserPromptSubmit  SubagentStart
```

Each runtime maps the vocabulary onto its own event names, and not every
runtime accepts every event:

- **Claude Code** accepts `PreToolUse`, `PostToolUse`, `Stop`, `Notification`,
  `SessionStart`, `SessionEnd`.
- **Gemini** accepts `BeforeTool`, `AfterTool`, `AfterAgent`, `Notification`
  (no session events).
- **Codewith** accepts `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`,
  `UserPromptSubmit`, `SubagentStart`.

Installing a hook for a target that has no mapping for one of the hook's
events fails with a clear error instead of writing an event key the runtime
would silently ignore.

Custom hooks live in `~/.hasna/hooks/hooks/<name>/` (see
`docs/custom-hooks.md`). Resolution order: the **custom directory first**
(`hooks/<name>/`, which includes artifacts written there by a remote sync),
then the **bundled registry**. A custom hook with the same name as a bundled
hook shadows it.

## 4. Versioning and trust

See `docs/versioning.md` for the full model. In short:

- Installed hooks are recorded in the `hooks` table and pinned in
  `hooks.lock` as `name` → `{version, sha256, source}`.
- `hooks update [name...]` re-registers the installed hooks (defaults to all
  installed) and refreshes the lock pins — it picks up a new `@hasna/hooks`
  package version; it does not resolve newer hook versions.
- A digest mismatch at run time refuses the hook and tells you to run
  `hooks trust <name>` — the same shape as Codewith's `trusted_hash` refusal.
- Rollback = restore `hooks.lock` and the hook files to a previous state; the
  run-time check verifies the restored bytes against the restored pin.

## 5. Database schema parity (SQLite ↔ D1)

The D1 schema mirrors the SQLite `hooks` table (migration `004_hooks_table`,
D1-compatible subset). The columns are identical so that the Worker can serve
the same catalog and lock surfaces without a translation layer:

- `hooks` — `id`, `name`, `version`, `sha256`, `source_type`, `source_ref`,
  `installed_at`, `enabled`, `last_verified_at`
- `hook_events` — the local event-history table (unchanged; not part of the
  D1 registry subset)

The lock is a derived view, not a table: locally it is the `hooks.lock` file;
on the Worker, `GET /api/v1/lock` derives it from the `hooks` rows.

## 6. API surface (`hooks serve`)

`hooks serve` runs the registry API locally (default port 39428) with the same
surface as the Cloudflare Worker. Routes:

| method | path | purpose | auth |
|---|---|---|---|
| GET | `/health` | liveness | none |
| GET | `/api/v1/catalog` | full catalog with digests | none |
| GET | `/api/v1/hooks/:name/:version` | one artifact (manifest+script envelope, `x-hook-sha256` header) | none |
| GET | `/api/v1/lock` | server-side lock state | none |
| PUT | `/api/v1/hooks` | publish a hook | API key |

Only `PUT /api/v1/hooks` requires a key (`X-API-Key` or
`Authorization: Bearer`). There is no `PUT /api/v1/lock`. See `docs/api.md`
for request/response shapes and error codes.

## 7. Cloudflare adapter (`hooks cf deploy`)

`hooks cf deploy` provisions the Cloudflare resources — the D1 database and
the R2 bucket — through the Cloudflare API, then prints the exact `wrangler`
commands for the worker upload. It does **not** upload the worker itself: the
worker needs the workerd target, which only wrangler can bundle, so the
command hands the operator the steps instead of shipping a token-bearing
upload path.

```
wrangler d1 migrations apply <database-name> --remote
wrangler secret put HOOKS_API_KEY
wrangler deploy --config wrangler.toml
```

Bindings are fixed:

```
HOOKS_D1       D1 database binding
HOOKS_R2       R2 bucket binding
HOOKS_API_KEY  secret binding (publish auth)
```

R2 artifact layout is per version:

```
hook_artifacts/<name>/<version>.json
```

Re-publishing the same `name@version` **overwrites** the object
unconditionally; there is no digest-collision rejection at publish time.
Digest integrity is enforced at consumption time: sync verifies the artifact
script against the lock entry before installing, and the run-time trust check
enforces the pin.

## 8. `hooks sync`

`hooks sync` reconciles a machine against the registry:

1. Resolve the transport through @hasna/contracts (strict pair, fresh per
   call): with a resolved credential + URL, the remote registry; under the
   explicit `HASNA_HOOKS_LOCAL=1` opt-in (and nothing configured in the env),
   the bundled catalog (all bundled hooks with their current versions and
   digests). A URL without a key, or any other refusal, aborts — there is no
   silent local fallback.
2. With a remote URL: pull the catalog and lock state from the API.
3. Compute the difference against the local `hooks` table and `hooks.lock`
   (added / updated / unchanged / skipped).
4. Verify every fetched artifact's script sha256 against the lock entry before
   installing; a mismatch aborts.
5. Fail closed: if the API is unreachable, **nothing changes** — sync exits
   non-zero and reports the failure instead of half-applying a stale view.
6. `--dry-run` prints the plan (adds, updates) without touching anything.
7. Hooks that exist locally but not in the remote catalog (or remote lock) are
   **never deleted** — local-only hooks are preserved by design.

## 9. Secrets handling

- The API key value resolves through the @hasna/contracts chain (hasna/apps#1720)
  fresh on every call: the Keychain item `hasna.credentials.hooks.api-key`,
  `~/.hasna/hooks/config/credentials`, or `HASNA_HOOKS_API_KEY` (the Worker's
  `HOOKS_API_KEY` secret binding is the server side of the same contract).
  There is deliberately no `--api-key` value flag on `hooks serve` — a secret
  on a CLI flag is visible in process listings and shell history (P1-8).
  `config.json` (which used to hold the `api_url` / `api_key_ref` key store)
  is retired and never read.
- Never print, log, or commit an API key or token. See the operator guide's
  secrets hygiene section (`docs/cloudflare.md`).

## 10. What this document does not cover

- Authoring custom hooks: `docs/custom-hooks.md`
- Running the Cloudflare backend: `docs/cloudflare.md`
- The wire contract: `docs/api.md`
- The versioning/lock/trust model in detail: `docs/versioning.md`
