# @hasna/hooks — Custom Hooks

> **Status: implemented.** This guide describes custom hooks as implemented on
> main (src/lib/manifest.ts, src/lib/custom-install.ts, src/lib/store.ts).

Custom hooks are user-authored hooks that live in
`~/.hasna/hooks/hooks/<name>/` and take precedence over bundled hooks of the
same name. This guide covers the manifest, events, installation, local
testing, the trust flow, and sharing hooks with a registry.

## 1. The manifest

Every custom hook is a directory containing a `manifest.json` and the script
it declares. The manifest schema:

```jsonc
{
  "name": "ci-guard",               // must match /^[\w-]+$/ — no scoped names
  "version": "1.0.0",               // semver, X.Y.Z
  "description": "Block commits that skip CI checks",
  "events": ["PreToolUse", "Stop"], // which events this hook subscribes to
  "script": "guard.sh",             // relative path to the executable, or an
                                    // inline script string
  "args": ["--strict"],             // optional arguments passed to the script
  "timeout_ms": 30000,              // optional execution timeout
  "env": { "PATH": "/usr/bin:/bin" } // optional per-hook environment
}
```

| field | type | required | description |
|---|---|---|---|
| `name` | string | yes | unique name, must match `/^[\w-]+$/` (letters, digits, `_`, `-`; no `/`, so scoped names like `my-org/ci-guard` are rejected) |
| `version` | string | yes | semver, `X.Y.Z` |
| `description` | string | no | one line, shown in `hooks list` and the catalog |
| `events` | string[] | yes | subset of the event vocabulary below (1+) |
| `script` | string | yes | relative path, or an inline script |
| `args` | string[] | no | arguments passed to the script at run time |
| `timeout_ms` | number | no | positive integer; script timeout |
| `env` | object | no | per-hook environment passed to the script's child process |

**`env` and PATH.** Every hook child already receives a sanitized environment:
credential-shaped names, interpreter-injection variables, and bash
exported-function entries are stripped, and `PATH` is rebuilt from the system
directories plus the runner's own `bun` directory, with every entry that
lives under `$HOME`, `/tmp`, `/var/tmp`, or a world-writable path removed —
a fake `node`/`git` planted in a writable directory must never execute on
the hook's first command. The `env` field can add variables (all still
filtered through the same strips), and `env.PATH` is the explicit override
for hooks that need a different search path: it is passed **verbatim**, so
include every directory the hook needs.

A manifest that fails validation (missing field, invalid semver, name that
does not match the pattern, unknown event, unresolvable script path) is
rejected at install time with a concrete error — nothing is written until the
whole manifest is valid.

## 2. Events

The manifest event vocabulary has eight events:

```
PreToolUse  PostToolUse  Stop  Notification  SessionStart  SessionEnd  UserPromptSubmit  SubagentStart
```

| event | when it fires | typical use |
|---|---|---|
| `PreToolUse` | before a tool call executes | gates, guards, secrets scans |
| `PostToolUse` | after a tool call completes | capture output, logging |
| `Stop` | turn ends | heartbeats, evidence best-effort |
| `Notification` | notification events | context refresh, DM injection |
| `SessionStart` | session begins | context injection, digests |
| `SessionEnd` | session ends | cleanup |
| `UserPromptSubmit` | user prompt submitted | prompt guards, paste-policy checks |
| `SubagentStart` | subagent spawned | context packs for subagents |

Not every runtime accepts every event. Installing a hook for a target that
has no mapping for one of its events fails with a clear error:

- **Claude Code** maps `PreToolUse`, `PostToolUse`, `Stop`, `Notification`,
  `SessionStart`, `SessionEnd` 1:1 (no `UserPromptSubmit`/`SubagentStart`).
- **Gemini** maps to `BeforeTool`, `AfterTool`, `AfterAgent`, `Notification`
  (no session events).
- **Codewith** maps `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`,
  `UserPromptSubmit`, `SubagentStart` (no `Notification`/`SessionEnd`).

A hook authored for the shared vocabulary runs on the runtimes that support
its events.

## 3. Where files live

```
~/.hasna/hooks/hooks/<name>/
├── manifest.json
└── <script>            # whatever the manifest declares
```

The directory is the unit of custom installation: `hooks install` copies the
whole directory into place for path/URL/git sources. The custom directory has
precedence over catalog resolution — if `~/.hasna/hooks/hooks/<name>/` exists,
that is the hook that runs, even when a bundled `name` exists in the registry.

## 4. Installing

```bash
# from the registry (bundled catalog)
hooks install pre-bash

# from a local path
hooks install ./my-hooks/ci-guard

# from a git URL (shallow clone of the hook repo)
hooks install https://github.com/acme/hooks-ci-guard.git

# from a manifest URL (any https URL serving a manifest.json)
hooks install https://hooks.acme.dev/ci-guard/manifest.json
```

Every install:

1. Resolves the source and reads the manifest.
2. Validates the manifest.
3. For a custom source, writes the files to `~/.hasna/hooks/hooks/<name>/`;
   for a registry name, registers a `hooks run <name>` entry in the agent
   settings (`~/.claude/settings.json` or a Codewith TOML fragment) — no
   files are copied for bundled hooks.

The pin (the `hooks` table row and the `hooks.lock` entry) is written by the
first run of the hook (`checkScriptHash` pins the current hash and passes),
or explicitly by `hooks sync`, `hooks update`, and `hooks trust` — see §6.

The install argument takes **names, local paths, git URLs, or manifest
URLs** — there is no `name@version` pin in the install argument. When a
remote registry is configured, installs of registry names first try the
local custom directory, then the bundled catalog (see `docs/architecture.md`
§3).

## 5. Testing a hook locally

```bash
hooks run <name> [--profile <id>]
```

`hooks run` executes the hook's script. It performs the trust check first
(the script's sha256 must match the pinned digest — see §6), then runs the
script with the JSON context passed on **stdin** (the agent runtime passes
hook context as JSON). The hook's decision is its exit code and stdout; with
`--profile`, the profile's agent data is injected into the stdin JSON before
execution.

```bash
echo '{"command":"git push origin main"}' | hooks run ci-guard
```

`hooks run` is what the agent settings invoke (`hooks run pre-bash`); it is
not a synthetic-event simulator.

## 6. The trust flow

Digest verification is not optional:

1. The first time a hook runs, its script sha256 is recorded and trusted
   **implicitly by that first run** (`checkScriptHash` pins the current hash
   and passes). `hooks sync`, `hooks update`, and `hooks trust` also record
   pins explicitly.
2. If an installed artifact is ever found to mismatch its pinned digest (a
   tampered file, a partial write, a corrupted store), the hook **refuses to
   run** and `hooks run` reports the mismatch with the expected and actual
   digests.
3. Acceptance of the new content is recorded with:

   ```bash
   hooks trust <name>
   ```

   This re-pins the sha256 of the script currently on disk. Trust is bound
   to a digest, not to a name: trusting `ci-guard` trusts the digest that is
   currently pinned; a later digest is a new decision. A mismatch you did not
   initiate is an incident, not a routine approval — use `hooks trust`
   deliberately.

`hooks update [name...]` re-registers installed hooks (defaults to all
installed) and refreshes their lock pins — it is how a new `@hasna/hooks`
package version takes effect; it applies immediately and does not stage a
new digest for later approval.

## 7. Sharing hooks with a registry

There is no `hooks publish` command. A hook becomes shareable by publishing
its artifact to the remote registry's API directly — only `PUT
/api/v1/hooks` (the Worker implementation) accepts a full artifact:

```bash
curl -sS -X PUT <api-url>/api/v1/hooks \
  -H "X-API-Key: $HOOKS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"manifest":{"name":"ci-guard","version":"1.0.0","events":["PreToolUse","Stop"],"script":"guard.sh"},"script":"…"}'
```

Semantics:

1. The Worker computes the sha256 of the script, writes the artifact to R2
   and upserts the D1 row.
2. Re-publishing the same `name@version` **overwrites** — there is no
   collision rejection; bump the version to keep history.
3. Consumers (other machines) reach the artifact via `hooks sync`, which
   verifies the script digest against the lock before installing.

Publishing requires a configured remote registry and a valid API key
(`X-API-Key` or `Authorization: Bearer`). A custom hook you never publish is
not visible to anyone else — local custom hooks are private to the machine by
construction.

## 8. Removing

```bash
hooks remove <name>
```

Unregisters the hook from the agent settings (Claude/Gemini; Codewith
removal is a no-op — its TOML config is managed by open-configs, so installs
emit fragments instead). It does not delete the custom directory or the lock
entry, and it does not remove event history (`hook_events` rows are
retained).
