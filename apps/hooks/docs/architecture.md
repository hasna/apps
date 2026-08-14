# @hasna/hooks — Architecture

> **Status: implementation in progress — lane L1 (PR pending). These docs describe the target state.**

This document describes the target architecture of `@hasna/hooks` after the
hooks unification: a single hook model (bundled, published, and custom), a
dual-backend storage design with local as the default and a Cloudflare-backed
remote as an explicit opt-in, and one versioning/trust model that works on
both.

## 1. Design principles

1. **Local by default.** A fresh install works entirely offline. Nothing is
   configured, uploaded, or synced unless you opt in.
2. **One switch.** There are no deployment modes, no `local`/`cloud` mode
   enums, and no placement vocabulary. The only thing that selects the remote
   backend is whether an API URL is configured — via the
   `HASNA_HOOKS_API_URL` environment variable or the `api_url` field in
   `config.json`. Unset means local. Set means the client talks to that API
   for catalog, artifacts, and lock state.
3. **Artifacts are immutable and content-addressed.** A hook version's
   artifact is keyed by the sha256 of its manifest+script bundle. The digest,
   not a mutable pointer, is what gets pinned, trusted, and verified.
4. **The lockfile is the source of truth for what runs.** `hooks.lock` pins
   every installed hook to an exact version and digest. Install, update,
   sync, and rollback all operate on the lockfile.
5. **Trust is explicit and per-hook.** A hook whose artifact does not match
   its pinned digest refuses to run. `hooks trust <name>` records your
   acceptance of a new digest — mirroring Codewith's `trusted_hash` model.

## 2. The two backends

### 2.1 Local (default, zero configuration)

```
~/.hasna/hooks/
├── config.json          # client config: api_url (absent = local), api_key_name, profiles
├── hooks.db             # SQLite database (owned by this package)
├── hooks/
│   └── <name>/          # custom hooks (installed by path/URL/git)
│       └── manifest.json
├── lock/hooks.lock      # semver pins + sha256 digests
└── profiles/            # per-profile hook sets (existing behaviour)
```

The SQLite database (`hooks.db`) owns the hook catalog state: the `hooks`
table (name, version, digest, source, custom flag), the existing `hook_events`
table for event history, and lock state. The schema is owned by this package
and evolved through its own migrations (see `src/db/migrations/`).

The local store serves as both catalog and artifact store: installing from a
registry, a local path, a git URL, or a manifest URL writes the artifact under
`~/.hasna/hooks/hooks/<name>/` and records it in the `hooks` table.

### 2.2 Cloudflare backend (opt-in)

Setting `HASNA_HOOKS_API_URL` (env) or `api_url` in `config.json` selects the
remote backend. The client then talks to a Workers API that fronts:

- **D1** — the catalog and lock tables (schema-parity with SQLite, see §5).
- **R2** — immutable artifacts, stored at `hook_artifacts/<name>/<version>.json`
  (the JSON envelope contains the manifest, the script, and the sha256 of the
  bundle).

The Workers API is exposed locally with `hooks serve` and deployed with
`hooks cf deploy`; see `docs/cloudflare.md` for the operator guide and
`docs/api.md` for the wire contract.

Nothing about the client's model changes when the backend is remote. The same
commands, the same lockfile format, the same trust rules. The backend only
changes *where* the catalog and artifacts come from and *where* the lock
state is pinned.

## 3. Hook model

Every hook — bundled, published, or custom — is described by a manifest:

| field | type | description |
|---|---|---|
| `name` | string | unique hook name (`pre-bash`, `my-org/ci-guard`, …) |
| `version` | string | semver (`1.4.0`) |
| `description` | string | one-line summary |
| `events` | string[] | the hook events this hook subscribes to |
| `script` | string | relative path to the executable script (or inline script) |

The event set is the same across runtimes:

```
PreToolUse  PostToolUse  SessionStart  Stop  UserPromptSubmit  SubagentStart
```

- **Claude Code** hooks are declared via the settings/hooks mechanism and the
  event names above map 1:1.
- **Codewith** declares the same set under `[hooks]` configuration, with the
  same event names. One manifest, one event vocabulary, both runtimes.

Custom hooks live in `~/.hasna/hooks/hooks/<name>/` (see `docs/custom-hooks.md`).
A custom hook with the same name as a bundled or published hook **takes
precedence** — the local `hooks/<name>/` directory wins over registry
resolution. Precedence order: **custom dir → local catalog (installed
versions) → remote catalog (when configured)**.

## 4. Versioning and trust

See `docs/versioning.md` for the full model. In short:

- Installed versions are recorded in the `hooks` table and pinned in
  `hooks.lock` as `name@version#sha256`.
- `hooks update` moves pins within semver rules and refuses to change a pin
  when the resolved artifact's sha256 does not match the record.
- A digest mismatch at install, sync, or run time refuses the hook and asks
  for re-approval via `hooks trust <name>` — the same shape as Codewith's
  `trusted_hash` refusal.
- Rollback = revert `hooks.lock` to a previous state and reinstall the pinned
  versions.

## 5. Database schema parity (SQLite ↔ D1)

The D1 schema mirrors the SQLite schema. The table names, columns, and
constraints are identical so that `hooks sync` can reconcile either direction
without a translation layer:

- `hooks` — `name`, `version`, `sha256`, `source` (`registry|custom`),
  `installed_at`, `updated_at`
- `hook_events` — the existing event-history table (unchanged)
- `lock` — the server-side mirror of `hooks.lock` (per-tenant row or rows)

Migrations are authored once, in SQLite, and applied to D1 through the same
numbered migration list. A schema change ships with both backends in the same
release; there is no window where one backend is ahead of the other.

## 6. API surface (`hooks serve`)

`hooks serve` runs the Workers API locally (and is what `hooks cf deploy`
uploads to Cloudflare). Routes:

| method | path | purpose |
|---|---|---|
| GET | `/health` | liveness (no auth) |
| GET | `/api/v1/catalog` | full catalog with versions and digests |
| GET | `/api/v1/hooks/:name/:version` | one artifact (manifest+script envelope, `X-Hooks-Sha256` header) |
| PUT | `/api/v1/hooks` | publish a hook (auth) |
| GET | `/api/v1/lock` | server-side lock state (auth) |
| PUT | `/api/v1/lock` | publish a lock state (auth) |

All `/api/v1/*` routes except `/health` require `X-API-Key: <key>`. See
`docs/api.md` for request/response shapes and error codes.

## 7. Cloudflare adapter (`hooks cf deploy`)

`hooks cf deploy` provisions the D1 database, the R2 bucket, and the worker,
then prints the exact `wrangler` upload command for the operator to run (or
runs it when the Cloudflare CLI is available). Bindings are fixed:

```
HOOKS_D1   D1 database binding
HOOKS_R2   R2 bucket binding
```

R2 artifact layout is immutable per version:

```
hook_artifacts/<name>/<version>.json
```

The stored JSON envelope is the manifest, the script payload, and the bundle's
sha256. Because the object key embeds name+version and the envelope carries
the digest, a PUT that collides with an existing key is rejected when the
digest differs — an immutable artifact can never be silently replaced.

## 8. `hooks sync`

`hooks sync` reconciles a machine against the remote backend (when
configured):

1. Pull the catalog and lock state from the API.
2. Compute the difference against the local `hooks` table and `hooks.lock`.
3. Verify every artifact's sha256 against the recorded digest before
   installing.
4. Fail closed: if the API is unreachable, **nothing changes** — sync exits
   non-zero and reports the failure instead of half-applying a stale view.
5. `--dry-run` prints the plan (installs, upgrades, downgrades) without
   touching anything.
6. Hooks that exist locally but not in the remote catalog (or remote lock)
   are **never deleted** — local-only hooks are preserved by design.

## 9. Secrets handling

- The API key value lives only in the environment (or is resolved through the
  Hasna secrets CLI / `secrets exec`). `config.json` stores the **key name
  reference**, never the value.
- Never print, log, or commit an API key or token. See the operator guide's
  secrets hygiene section (`docs/cloudflare.md`).

## 10. What this document does not cover

- Authoring custom hooks: `docs/custom-hooks.md`
- Running the Cloudflare backend: `docs/cloudflare.md`
- The wire contract: `docs/api.md`
- The versioning/lock/trust model in detail: `docs/versioning.md`
