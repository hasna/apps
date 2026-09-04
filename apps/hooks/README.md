# @hasna/hooks

Open source hooks library for AI coding agents - Install safety, quality, and automation hooks with a single command

[![npm](https://img.shields.io/npm/v/@hasna/hooks)](https://www.npmjs.com/package/@hasna/hooks)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/hooks
```

## CLI Usage

```bash
hooks --help
```

- `hooks install`
- `hooks list`
- `hooks search`
- `hooks remove`
- `hooks categories`
- `hooks info`
- `hooks doctor`
- `hooks run`

## Compact Output

CLI commands default to compact, agent-friendly output. List and search commands
show essential fields, cap terminal rows, and print hints for deeper inspection.
Use detail flags when you need more context:

```bash
hooks list                  # compact, capped list
hooks list --all            # show all rows
hooks list --verbose        # include descriptions
hooks search git --limit 5  # cap result rows
hooks info gitguard         # full metadata for one hook
hooks docs gitguard         # README preview
hooks docs gitguard --verbose
hooks list --json           # stable machine-readable full data
```

MCP tools follow the same gradual disclosure pattern: list/search/log/profile
tools return compact summaries by default, while explicit flags such as
`compact:false`, `verbose:true`, or a detail tool like `hooks_info` return full
records.

## Codewith-native hooks

@hasna/hooks includes unprefixed Codewith-native hook names:

- `session-start` — `SessionStart` digest and additional context.
- `prompt-guard` — `UserPromptSubmit` guard for pasted fake policy/freeze/run-this-now content.
- `pre-bash` — `PreToolUse` Bash gate for staged secrets scans, scoped destructive-operation blocks, and risky-op comms checks.
- `worktree-guard` — `PreToolUse` guard for managed repos worktree boundaries and file-tool-like payloads touching protected Hasna scopes.
- `stop-sync` — `Stop` turn-end heartbeat/evidence best effort.
- `knowledge-context` — deterministic Knowledge context packs for `SessionStart`, `UserPromptSubmit`, and `SubagentStart`.

For Codewith, the installer is renderer-safe by default: it emits a TOML
fragment instead of mutating managed `~/.codewith/config.toml`.

```bash
hooks install session-start prompt-guard pre-bash worktree-guard stop-sync knowledge-context --target codewith
```

The scoped destructive-operation guard does not block every cleanup command. It
blocks resolved shell/file-tool targets that threaten `/` or a system root
(`/usr`, `/etc`, `/bin`, `/lib`, `/var`, `/boot`, `/home`, `/Users`, and the
other FHS and macOS equivalents), `~/.hasna`, configured workspace roots, Hasna
division/scope roots, or active repo/worktree roots, including recursive `rm`,
`rsync --delete`, destructive `find`, and destructive `git clean` / `git reset
--hard` forms.

It also blocks by *shape*: a destructive target containing a command
substitution or variable expansion immediately followed by `/` is checked as the
shell would render it if that expansion returned empty, so
`rm -rf "$(anything)"/*` and `rm -rf "$VAR"/*` are refused whatever the
expansion is. Wrapped forms (`bash -c`, `su -c`, `eval`, `ssh host '…'`) are
unwrapped first. See [`hooks/pre-bash/README.md`](hooks/pre-bash/README.md) for
the full rules, the deliberate exemptions (`${VAR:?}`, bare `"$(cmd)"` with no
trailing separator), and the recommended safe form.

Apply that fragment through `configs` or the managed config renderer. A
direct write path exists only for explicit local/test use:

```bash
hooks install knowledge-context --target codewith --apply-codewith --codewith-config /tmp/codewith-config.toml
```

## Custom and remote hooks

A hook is defined by a manifest — `{ name, version, description, events, script, args?, timeout_ms? }` — where `script` is a relative path or inline content. Hooks come from three sources: the bundled registry, a user custom directory, or a remote registry.

`timeout_ms` is an optional positive integer (milliseconds). **Omit it for no timeout.** A timeout of 0 is never a real value: a manifest or MCP call that passes `0` (or a negative value) is rejected, and the SDK treats a non-positive option as not provided — falling back to the manifest value, or to no timeout when the manifest has none. So `timeout_ms: 0` can never mean "kill immediately"; either a positive bound applies or there is no bound at all.

**Install custom hooks** from a local directory, a git URL, or a manifest URL:

```bash
hooks install ./my-hook            # directory with manifest.json
hooks install git@github.com:org/hook-repo.git
hooks install https://example.com/hooks/my-hook/manifest.json
```

Custom hooks land in `~/.hasna/hooks/hooks/<name>/`. A custom hook with the same name as a bundled hook takes precedence (visible in `hooks info <name>`).

**Trust model.** Every hook script is pinned by sha256 in `~/.hasna/hooks/hooks.lock` and the SQLite `hooks` table. `hooks run` verifies the script hash before executing; if the script changed, the run is refused:

```bash
hooks trust <name>   # re-pin the current script content
hooks update         # re-register hooks and refresh pins
```

**Registry server.** `hooks serve` exposes the local store over HTTP — catalog, artifacts, and the published lock:

```bash
hooks serve --port 39428            # publish key resolves from HASNA_HOOKS_API_KEY / HOOKS_API_KEY only
# GET /health, GET /api/v1/catalog, GET /api/v1/hooks/:name/:version,
# PUT /api/v1/hooks (publish, requires the key), GET /api/v1/lock
```

**Registry selection (fail closed).** A registry API URL — env `HASNA_HOOKS_API_URL` (legacy aliases `HOOKS_API_URL`, `HASNA_HOOKS_REGISTRY_URL`, `HOOKS_REGISTRY_URL`) or the `api_url` field in `config.json` — selects the remote registry. Without one, the CLI **fails closed**: registry commands refuse to run rather than silently serving the bundled catalog and local SQLite store, and they name the required env in the error. Local mode (bundled registry + local store) is an explicit opt-in:

```bash
HASNA_HOOKS_LOCAL=1 hooks list      # canonical local opt-in
HOOKS_LOCAL=1 hooks list            # accepted alias
```

Surfaces that are local, runtime, or operator-only by design never need either setting: `run`, `serve`, `mcp`, `cf`, `migrate`, `init`, `profile-export`/`profile-import`, `channels`, `events`, and `--help`/`--version`.

```bash
hooks init --cloudflare --api-url https://registry.example.com --api-key <vault-key-name>
HASNA_HOOKS_LOCAL=1 hooks sync      # local workflow: bundled catalog into the local store
HASNA_HOOKS_LOCAL=1 hooks sync --dry-run  # print the plan without changing anything
```

`hooks init --cloudflare` writes the stored API URL into `config.json`, which satisfies the gate for the registry commands that follow.

`hooks init --cloudflare` stores the API URL and a vault key NAME in `~/.hasna/hooks/config.json` — never the key value. Serve with the key resolved from the vault:

```bash
secrets exec <vault-key-name> --as HASNA_HOOKS_API_KEY -- hooks serve
```

**Cloudflare provisioning.** `hooks cf deploy` creates the D1 database and R2 bucket via the Cloudflare API, then prints the exact wrangler commands for the worker upload (the worker needs the workerd target, which only wrangler can bundle):

```bash
export CF_API_TOKEN=...   # resolve from the vault, never paste the value
hooks cf deploy --account-id <id> --dry-run   # plan first
hooks cf deploy --account-id <id>
```

The worker (`src/cf/worker.ts`) implements the same API routes against D1 + R2, with artifacts at `hook_artifacts/<name>/<version>.json`. See `src/cf/wrangler.toml.example`.

## Storage

Hooks stores data locally by default in `~/.hasna/hooks/` and uses SQLite
directly for hook event history. The package owns its database schema and
migrations; it does not depend on the deprecated shared runtime or its CLI.
The repo includes its own PostgreSQL migration definitions for the optional
`hooks storage push|pull|sync` commands. Use the `hooks log` commands to inspect
local hook event data.

```bash
hooks storage status --json
HASNA_HOOKS_DATABASE_URL=postgres://... hooks storage push --tables hook_events,feedback --json
hooks storage pull --json
hooks storage sync --json
```

Configure database storage with `HASNA_HOOKS_DATABASE_URL` or fallback
`HOOKS_DATABASE_URL`.

### Storage backend

Hooks storage has one setting with two values: **which data backend**, not where
anything is deployed.

| `HASNA_HOOKS_STORAGE_BACKEND` (fallback `HOOKS_STORAGE_BACKEND`) | meaning |
| --- | --- |
| `sqlite` | the on-box SQLite file in `~/.hasna/hooks/` (default) |
| `postgresql` | the PostgreSQL database named by `HASNA_HOOKS_DATABASE_URL` |

Leave it unset and the backend is inferred exactly as before: `postgresql` when a
database URL is configured, `sqlite` otherwise. An unrecognised value is an
error, not a silent fall back to SQLite.

The former deployment-mode variables `HASNA_HOOKS_STORAGE_MODE` and
`HOOKS_STORAGE_MODE`, and their `local` / `hybrid` / `remote` / `self-hosted` /
`cloud` values, are **retired**. They are not read; setting one raises an error
naming the replacement variable and the backend to use (`local` became `sqlite`,
everything else became `postgresql`). Deployment location was never a property of
the data layer, so it is no longer expressed as one.

## Runtime model

This package is an npm CLI and MCP server. Installing
and running hooks needs nothing deployed anywhere — the SQLite backend is the
default and requires no server.

## Data Directory

Data is stored in `~/.hasna/hooks/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
