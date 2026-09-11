# @hasna/trash

Reversible deletion for agents — deletes land in a trash store, sync to cloud
storage, and expire on a retention you choose.

[![npm](https://img.shields.io/npm/v/@hasna/trash)](https://www.npmjs.com/package/@hasna/trash)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Deletes are the one operation an agent performs that has no undo. Trash gives
them one: a `rm` issued through an agent's shell is rewritten into a capture
*before it executes*, the bytes land in a trash store with their metadata,
and the copy is uploaded so the entry survives the machine that held it.

## The claim, stated precisely

> An agent cannot permanently destroy a file **that the capture layer
> accepts**, without a separate, irreversible action. Deletes the capture
> layer **refuses** (size, free space, permission, cross-device, excluded
> path) are refused as deletes too — see *Capture refusal* below.

Read the narrow form, not "`rm -rf` is impossible". There is no OS-level
guarantee here: an absolute-path `/bin/rm`, a program calling `unlink(2)`
directly, a container, another host, another user, or a daemon started before
install all bypass this. Trash sits at the **tool layer**, and that is the
layer agents actually delete through.

Trash is **not a backup**. The local store shares a failure domain with the
files it holds; durability comes from the cloud upload, not from the spool.
Trash also **does not free disk space** — it is a staging operation, not a
reclaim operation, and `df` will say so.

## Install

```bash
npm install -g @hasna/trash
```

Use `npm`, not `bun install -g`, for the first 7 days after a release: the
Bun quarantine (`minimumReleaseAge = 604800`) holds a freshly published
package back unless its exact name is added to `minimumReleaseAgeExcludes`.

Nothing is wired by installing. `trash init` is the explicit step that
registers the MCP server, the shell guard and the retention daemon — a
package lifecycle script never writes agent settings or pre-creates
`~/.hasna/trash` here.

## Two ways to run it

Mode is **derived from what resolves, never selected** by a flag or a
`mode` key in a config file. There is no deployment-word switch.

### 1. User-hosted (you run both halves)

You run `trash-serve` yourself, on your own machine or your own
infrastructure, with your own store, and point the CLI, MCP server and SDK at
it:

```bash
export HASNA_TRASH_API_URL="http://127.0.0.1:19433"
export HASNA_TRASH_API_KEY="$(openssl rand -hex 32)"

trash-serve --host 127.0.0.1 --port 19433 --data-dir ~/.hasna/trash
trash status                 # prints the resolved authority it is talking to
```

The API exposes `GET /health`, `/ready`, `/version`, the OpenAPI document at
`/openapi.json`, and the versioned surface under `/v1`. Uploads stay out of
the API's data path: the API vends a **presigned PUT** with the content
digest bound into it and the client uploads **directly to your bucket**.
`--host`, `--port`, `--data-dir`, `--json` and `--version` are honoured.

### 2. Hasna SaaS (we run the API)

Same client, same commands — the only difference is which authority and
credential resolve:

```bash
export HASNA_TRASH_API_URL="https://api.hasna.com/trash"   # the hosted authority
export HASNA_TRASH_API_KEY="…"                             # from the hosted dashboard
trash status                 # API: https://api.hasna.com/trash/v1 — transport, key present
```

The credential is resolved through the ONE `@hasna/contracts` resolver —
the `HASNA_TRASH_API_KEY` / `HASNA_TRASH_API_URL` pair named by this
package's `hasna.contract.json` (`metadata.client`) — not read out of the
environment by hand.

### The storage switch

Artifact placement is a **separate axis** from the API, and it is configured
by presence, not by a value:

| `HASNA_TRASH_BUCKET` | Where captured bytes are uploaded |
|---|---|
| set | that S3 bucket — the lifecycle rule on its `trash/` prefix *is* the cloud retention |
| unset | the local artifact directory, next to the spool |

The bucket name **is** the configuration: naming one turns uploads on, and
naming one that does not exist is an error, not a silent downgrade.

### Local-only, and failing closed

`HASNA_TRASH_LOCAL=1` opts into local-only operation. It is honoured **only
when nothing else configured an authority or a credential**; a configured
credential that no longer resolves is a **failure, not a mode change** — a
rotated, revoked or mistyped key must never silently reclassify a hosted
instance as local-only, because local-only is the mode that can expire
un-uploaded payloads. Local-only runs announce themselves on stderr so an
unhosted run is never mistaken for an empty hosted one.

## Surfaces

| Surface | Name |
|---|---|
| CLI | `trash` |
| MCP server (stdio) | `trash-mcp` |
| HTTP service | `trash-serve` |
| SDK | `import … from "@hasna/trash"` / `"@hasna/trash/sdk"` |

The shell guard is **`trash guard` — a subcommand of the CLI, not a bin of
its own**. `trash guard` reproduces `rm`'s flag and exit-code contract
(`-f`, `-i`, `-v`, `-d`, multi-target, `-f`/`-i` folding last-one-wins in
argv order, `-f` with no operands exiting 0) so that `&&` chains and callers
that check `$?` behave exactly as they did against `rm`.

## Retention

Two clocks, and the invariant that keeps them honest:

- **Local spool — 30 days** (a disk-space policy).
- **Cloud — 90 days** (`Expiration.Days` on the `trash/` prefix; the
  bucket's lifecycle rule is the GC, there is no application-level sweeper
  over remote objects).

A staged payload's bytes may be deleted locally **only if** a remote copy is
confirmed by matching sha256 at the moment of deletion, **or** the instance
is local-only, the entry is past `retentionDays`, and `--apply` was passed.
No sweep may take the un-uploaded count below `minUnuploadedKeep`, and no
sweep may touch an entry whose `pinned` flag is set. A short local window can
therefore never destroy the last copy.

Cloud expiry is **asynchronous** — AWS documents the latency in days or
weeks. There is deliberately no countdown-to-the-minute UX.

## Configuration

`<config home>/trash/config.json`:

```json
{
  "storage":   { "maxSizeBytes": 10737418240 },
  "retention": { "maxTotalBytes": 21474836480, "maxEntries": 100000,
                 "retentionDays": 30, "minUnuploadedKeep": 100,
                 "dryRun": true, "requireExplicitApply": true },
  "capture":   { "maxEntryBytes": 2147483648, "minFreeBytes": 2147483648,
                 "linkWhenSameDevice": true, "onRefuse": "record",
                 "excludeGlobs": ["**/node_modules/**", "**/.git/objects/**",
                                  "**/target/**", "**/dist/**",
                                  "**/.venv/**", "**/__pycache__/**"] }
}
```

Roots resolve through `HASNA_CONFIG_HOME` / `HASNA_DATA_HOME` /
`HASNA_STATE_HOME`, with the legacy default `~/.hasna/trash/{files,info}`:

| Artifact | Path |
|---|---|
| Staged bytes | `<data home>/trash/files/<id>` |
| Index (per-entry metadata) | `<state home>/trash/info/<id>.json` |
| Config | `<config home>/trash/config.json` |

Bytes and index never live in the cache root — cache is droppable by
definition.

### Capture refusal

If the capture layer cannot take a file, the delete is **refused** unless the
path matches an `excludeGlobs` entry, in which case it proceeds. Over size
(`maxEntryBytes`), free space below `minFreeBytes`, `EPERM`, a cross-device
move, or an unreadable path ⇒ *if we cannot capture it, we do not delete it*.
The glob list is what identifies the not-precious class (`node_modules`,
build output, caches); without that split a full disk would self-lock, since
the delete you run to free space is the one that could not run. Every refusal
is recorded with its reason, and `--force` overrides.

Cross-device captures are refused rather than copied: a copy is the
worst outcome — it looks like it worked while doubling a multi-gigabyte tree.
Capturing a tree uses `rename()` (atomic, same device); a loose file uses
`link()`. Symlinks are captured **as objects, never traversed**, and trailing
slashes are stripped before `lstat` so a link is not followed by accident.

## What this does NOT cover

These boundaries are part of the contract, not caveats discovered later.

- **Only Bash-tool deletes are intercepted, and only `rm`-grammar ones.**
  `git rm`, `find -delete`, `shred`, `rmdir` and wrapper-mediated deletes are
  **refused with a reason, not rewritten** — a wrong rewrite is silent, and a
  refusal is visible. A subprocess that deletes (`python3 cleanup.py`,
  `npm run clean`), a dynamic command (`cmd=rm; "$cmd" f`), and destructive
  code inside a command substitution all run **before** the guard: the guard
  rewrites a command string, it does not sandbox a process tree.
- **Non-Bash agent mutations are uncovered.** `Write` can overwrite a file,
  `Edit` can empty one, and an MCP files server can delete directly.
  Pre-image capture for those tools is wave 2.
- **A hook that fails, times out, is removed, or was never installed runs the
  original `rm`.** A timed-out hook does not block, and an agent with write
  access to agent settings can remove the hook.
- **Privilege and isolation:** multi-user machines, `sudo`, and deletes
  inside containers are out of coverage. Unsupported privilege transitions
  are refused. Do not treat privileged bytes as captured.
- **Payload confidentiality:** trashing deleted credentials or key material
  into cloud storage retains secrets you believed were removed. `purge` is
  the explicit, irreversible action for that case.
- **Nothing here holds against a hostile agent.** The threat model is
  **accident, not adversary**: a same-user agent can remove the hook, edit
  the spool, clear `pinned`, or call `unlink(2)` directly. If an adversary
  ever enters scope, purge authority has to be separated from capture
  authority — a different design, not a setting.

## Implementation status

This package is being built in phases, and this README documents the product
those phases add up to. What has landed:

- **Phase 0 (this release)** — the member: four surfaces (`trash`,
  `trash-mcp`, `trash-serve`, `./sdk`), the service contract, and the
  package skeleton.

Still to land, in order: the store and its crash-safe publish (phase 1); the
`trash guard` rewrite and the `PreToolUse` hook registration, with the live
end-to-end delete test as the gate (phase 2); `trash-serve` `/v1`, presigned
uploads with server-side checksum confirmation, and the independent-timer
retention sweep (phase 3); `trash init` and `trash doctor` (phase 4). The
`trash-daemon` bin arrives with the retention daemon in phase 3.

`trash doctor` is the deliverable that matters most: a guard that silently
isn't installed is worse than no guard, because it produces false confidence.

## Development

```bash
bun install
bun run verify            # typecheck + test + build + contract:check
bun run contract:check    # contracts repo-conformance (hasna.contract.json)
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
