# @hasna/hooks — Custom Hooks

> **Status: implementation in progress — lane L1 (PR pending). These docs describe the target state.**

Custom hooks are user-authored hooks that live in
`~/.hasna/hooks/hooks/<name>/` and take precedence over bundled and published
hooks of the same name. This guide covers the manifest, events, installation,
local testing, the trust flow, and publishing.

## 1. The manifest

Every custom hook is a directory containing a `manifest.json` and the script
it declares. The manifest schema:

```jsonc
{
  "name": "ci-guard",              // unique name; may be scoped: "my-org/ci-guard"
  "version": "1.0.0",              // semver
  "description": "Block commits that skip CI checks",
  "events": ["PreToolUse", "Stop"], // which events this hook subscribes to
  "script": "guard.sh"             // relative path to the executable, or an
                                   // inline script string
}
```

| field | type | required | description |
|---|---|---|---|
| `name` | string | yes | unique name, `[a-z0-9][a-z0-9._/-]*` |
| `version` | string | yes | semver, `X.Y.Z` |
| `description` | string | yes | one line, shown in `hooks list` and the catalog |
| `events` | string[] | yes | subset of the event vocabulary below |
| `script` | string | yes | relative path, or an inline script |

A manifest that fails validation (missing field, invalid semver, unknown
event, unresolvable script path) is rejected at install time with a concrete
error — nothing is written until the whole manifest is valid.

## 2. Events

The event vocabulary is identical across runtimes:

```
PreToolUse  PostToolUse  SessionStart  Stop  UserPromptSubmit  SubagentStart
```

| event | when it fires | typical use |
|---|---|---|
| `PreToolUse` | before a tool call executes | gates, guards, secrets scans |
| `PostToolUse` | after a tool call completes | capture output, logging |
| `SessionStart` | session begins | context injection, digests |
| `Stop` | turn ends | heartbeats, evidence best-effort |
| `UserPromptSubmit` | user prompt submitted | prompt guards, paste-policy checks |
| `SubagentStart` | subagent spawned | context packs for subagents |

- **Claude Code** maps these names 1:1 to its hooks mechanism.
- **Codewith** declares the same names under `[hooks]` configuration. There
  is no second vocabulary; a hook authored once runs on both.

## 3. Where files live

```
~/.hasna/hooks/hooks/<name>/
├── manifest.json
└── <script>            # whatever the manifest declares
```

The directory is the unit of installation: `hooks install` copies the whole
directory into place (for path/URL/git sources), or writes the fetched
artifact (for registry/manifest-URL sources). The custom directory has
precedence over catalog resolution — if `~/.hasna/hooks/hooks/<name>/` exists,
that is the hook that runs, even when a published `name` exists in a registry.

## 4. Installing

```bash
# from the registry (bundled or published catalog)
hooks install ci-guard

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
3. Computes the sha256 of the artifact bundle.
4. Records `name@version#sha256` in the `hooks` table and `hooks.lock`.
5. Writes the files to `~/.hasna/hooks/hooks/<name>/`.

When a remote backend is configured, installs of registry names first try the
local custom directory, then the local catalog, then the remote catalog (see
`docs/architecture.md` §3).

## 5. Testing a hook locally

```bash
hooks run <name> --event <EVENT> [--tool <tool>] [--input <json>] [--dry-run]
```

`hooks run` executes the hook's script against a synthetic event payload and
prints the hook's decision:

- `continue` — the hook permits the action
- `block` — the hook refuses; the reason is printed
- error — the hook failed; the error is printed with the exit code

Examples:

```bash
hooks run ci-guard --event PreToolUse --tool Bash --input '{"command":"git push origin main"}'
hooks run prompt-guard --event UserPromptSubmit --dry-run
```

`--dry-run` prints what would be executed without running the script. Use
`--event` values from the vocabulary in §2; an unknown event name is rejected.

## 6. The trust flow

Digest verification is not optional:

1. On install, the artifact's sha256 is recorded and trusted **implicitly by
   the install itself** (you asked for this hook; the digest you received is
   the digest that runs — pinned from that moment).
2. On **update**, `hooks update <name>` resolves the new version. If the new
   artifact's sha256 differs from the previously trusted digest (which it
   will, for any real change), the update **does not silently apply**: the new
   digest is reported and the hook runs only after you approve it.
3. Approval is recorded with:

   ```bash
   hooks trust <name>
   ```

   This mirrors Codewith's `trusted_hash` model: trust is bound to a digest,
   not to a name. Trusting `ci-guard` trusts the digest that is currently
   pinned; a later digest is a new decision.

4. If an installed artifact is ever found to mismatch its pinned digest (a
   tampered file, a partial write, a corrupted store), the hook **refuses to
   run** and `hooks run`/`hooks sync` reports the mismatch with the expected
   and actual digests. `hooks trust <name>` is the only way to accept the new
   digest, and it should be used deliberately — a mismatch you did not
   initiate is an incident, not a routine approval.

## 7. Publishing to a registry

A published hook is the same directory — manifest + script — uploaded to the
remote backend:

```bash
hooks publish ./my-hooks/ci-guard
```

What happens:

1. The manifest is validated and the bundle digest computed.
2. The artifact is PUT to `PUT /api/v1/hooks` with the
   `X-Hooks-Sha256` header (see `docs/api.md`).
3. The remote store rejects a collision: publishing the same
   `name@version` with a **different** digest fails; re-publishing the same
   digest is idempotent.

Publishing requires a configured remote backend and a valid API key
(`X-API-Key`). A custom hook you never publish is not visible to anyone else —
local custom hooks are private to the machine by construction.

## 8. Removing

```bash
hooks remove <name>
```

Removes the custom directory and the lock entry. Removing a hook does not
remove its event history (`hook_events` rows are retained).
