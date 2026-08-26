# Changelog

## 0.7.10

### Patch Changes

- Updated dependencies [2a65f40]
  - @hasna/contracts@0.14.2

## 0.7.9

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.7.8

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0
  - @hasna/secrets@0.3.10

## 0.7.7

### Patch Changes

- Updated dependencies [4af006f]
  - @hasna/secrets@0.3.7

## 0.7.6

### Patch Changes

- 2b87a81: Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have, and testers pins @hasna/browser to the published 0.5.29.

## 0.7.5

### Patch Changes

- Updated dependencies [ae4567b]
  - @hasna/secrets@0.3.6

## 0.7.4

### Patch Changes

- Updated dependencies [50473b8]
  - @hasna/secrets@0.3.5

## 0.7.3

### Patch Changes

- 1481a94: hooks-serve answers --help and --version before any port parse or bind; previously `hooks-serve --version` fell through to the bind path, bound the listener at 127.0.0.1:39428, and never exited (rc=124 under timeout, empty stdout) instead of printing the version (todos row dc92977d).
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.7.2

### Patch Changes

- Updated dependencies [d7d615b]
  - @hasna/secrets@0.3.4
  - @hasna/contracts@0.13.3

## 0.7.1

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.7.0

### Minor Changes

- **Breaking default change:** remove the private workspace org from hook-workspace-repos-guard's default allowed-orgs list. The public tarball must not ship the private org marker (the repo publish guard defines it as a forbidden internal-infra string; it scans packed member names, so it cannot see it in file contents — this release sanitizes the shipped content). Private workspace orgs are restored per-install with the WORKSPACE_REPOS_GUARD_ORGS env var (comma-separated). Installs relying on the default become fail-closed for writes into repos of non-default orgs. This is a behavior-default change, so it ships on a new non-compatible line (0.7.0) rather than a patch; consumers on ^0.6.x ranges are not auto-upgraded.

This release also carries the previously unshipped 0.6.9-0.6.11 version-wave content (dependency bumps).

## 0.6.11

### Patch Changes

- Updated dependencies [b2638b2]
  - @hasna/secrets@0.3.3
  - @hasna/contracts@0.13.1

## 0.6.10

### Patch Changes

- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
- Updated dependencies [0d4f749]
- Updated dependencies [ca7acc8]
- Updated dependencies [4e5b690]
- Updated dependencies [28fedae]
  - @hasna/contracts@0.13.0
  - @hasna/secrets@0.3.2

## 0.6.9

### Patch Changes

- 38c7d92: Hooks hardening 0.6.6: sanitized hook child environments (allowlist + name-based deny list, incl. MEMENTOS\__ and _\_URL/\*\_URI), loopback-only MCP SSE with auth, event-log redaction at write and read (current key formats: OpenAI project/service and Anthropic key forms, Stripe test/live restricted and secret key forms, Bearer units, URL userinfo, spaced/quoted/multiline values), immutable registry versions with exact-pin installs, verified PG TLS with proper sslmode parsing, fail-closed lock and atomic sync, redirect-refusing URL installs, script_kind honored in registry installs (serve and sync), explicit older pins preserved across syncs, mixed-install failure exit codes, shared semver at the CLI boundary, and doctor bounds reporting in every branch. See apps/hooks/CHANGELOG.md.
- 4e6f158: Hooks hardening 0.6.7: strip interpreter-injection variables from hook child environments (BASH_ENV/ENV sourcing vectors, BASHOPTS/SHELLOPTS, NODE_OPTIONS/NODE_PATH, PYTHONSTARTUP/PYTHONINSPECT/PYTHONPATH, LD_PRELOAD/LD_LIBRARY_PATH — bug cf99cf76), and never move the registry latest pointer down: publish compares by full semver precedence (shared compareVersions) so an older-version republish stores its row without downgrading the pointer, and the crash-window heal picks the highest semver per name rather than the latest published_at (bug 6e412e52). See apps/hooks/CHANGELOG.md.
- Updated dependencies [b630c48]
- Updated dependencies [8de5bb5]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16
  - @hasna/secrets@0.3.1

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.8] - 2026-08-15

### Security

- **Bash exported functions can no longer be imported by hook children (reviewer P1, efcad315).** Bash imports exported functions from `BASH_FUNC_<name>%%` environment entries, where they shadow commands (`env`, `cat`, `git`, `node`) and run attacker code on the hook's first command — the strip set and the deny list both missed them. `buildHookEnv` now strips every `BASH_FUNC_*` entry from the parent env and caller extras. Aliases are deliberately not denied: bash cannot import aliases from the environment, only functions — the strip is exactly the `BASH_FUNC_` prefix.
- **The same-class interpreter/TLS vectors are stripped (reviewer P2).** `GCONV_PATH`/`LOCPATH` (gconv/locale module injection), `PYTHONHOME` (stdlib hijack), the whole `GIT_CONFIG_*` family (code exec via git config), the TLS-trust MITM set — `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `AWS_CA_BUNDLE` (observed leaking live on old code) — and `PERL5OPT`/`RUBYOPT` are now stripped from parent env and extras.
- **Hook PATH is rebuilt from a trusted baseline (reviewer P2).** A fake `node`/`git` in a writable directory used to execute on the hook's first command because PATH was allowlisted raw. The child PATH now starts from the system directories (plus `/opt/homebrew/bin` on macOS) and the runner's own `bun` directory, and drops every entry under `$HOME`, `/tmp`, `/var/tmp`, or a world-writable path, plus empty/relative entries. A manifest `env.PATH` is the documented explicit override, passed verbatim.

### Fixed

- **The registry latest-pointer upsert is atomic (reviewer P2).** The pointer compare-and-update was read-then-write: two concurrent publishes of the same name could both read the same pointer and the older landed last (downgrade), and the crash-window heal could clobber a concurrently-advanced pointer. The upsert is now a compare-and-swap inside a D1 `batch()` transaction (`DO UPDATE ... WHERE hooks.version IS ? OR hooks.version = ?` — D1 exposes no BEGIN/COMMIT; batch is the atomic transaction primitive), with a bounded re-read/retry on a lost race. The heal writes a single guarded statement (`INSERT ... WHERE NOT EXISTS`), so a pointer advanced between its read and write can never be clobbered.
- **Semver numeric identifiers are strict (reviewer P3).** `1.0.0-01` vs `1.0.0-1` compared >0 in BOTH directions (Number("01") === Number("1") while the strings differ), and near-16-digit numeric identifiers lost precision to Number(). Numeric identifiers with leading zeroes and identifiers longer than 16 digits are now rejected as invalid semver everywhere (manifest, publish, artifact routes — one shared pattern), and `compareVersions` compares numerics as BigInt, so ordering is exact and antisymmetric at any length.
- **Hook interpreters resolve independently of the child PATH.** The runner now spawns `process.execPath` (its own bun binary) instead of the bare `bun`, so a sanitized PATH or a per-hook PATH override can never break the spawn of a `.ts` hook.

## [0.6.7] - 2026-08-15

### Security

- **Interpreter-injection variables are stripped from hook child environments (bug cf99cf76).** The P1-1 deny list stripped credential-shaped NAMES, but a credential can be re-imported from a FILE through interpreter machinery: `BASH_ENV` tells bash to source a file before every non-interactive run and `ENV` does the same for interactive shells, so a parent whose `BASH_ENV` points at e.g. hasna-cloud-env.sh handed the hook child a process that re-exported the fleet credential env after the deny list ran. `buildHookEnv` now strips the interpreter-injection set — `BASH_ENV`, `ENV`, `BASHOPTS`, `SHELLOPTS`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONSTARTUP`, `PYTHONINSPECT`, `PYTHONPATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH` — from both the parent env and caller extras, so no child interpreter can source or run code the hook did not ask for. The single shared `buildHookEnv` covers every run path (CLI, MCP, SDK).

### Fixed

- **The registry latest pointer never moves down (bug 6e412e52).** Publishing an OLDER version (1.0.1 after 1.0.2) previously moved the catalog/lock latest pointer DOWN. The pointer now compares by full semver precedence (shared `compareVersions`, semver.org §11) and only moves forward — equal or higher updates it, lower keeps the current pointer while the (name, version) row and artifact are still stored (history grows). The crash-window heal path (`ensureLatestRows`) picks the highest-semver version per name instead of the latest `published_at`, which had the same downgrade risk when an older version was republished later.

## [0.6.6] - 2026-08-15

### Security

- **Hook child processes get a sanitized environment (P1-1).** A hook previously inherited `process.env` wholesale, so third-party hook bytes could read every credential the agent session holds. Children now get a fixed non-secret allowlist (PATH, HOME, LANG, TZ, SHELL, TERM, USER, PWD), non-secret `HOOKS_*` projections of the parent's `HASNA_HOOKS_*` config, and caller extras — all filtered through a documented name-based deny list (`*KEY`, `*TOKEN`, `*SECRET`, `*PASSWORD`, `*URL`, `*URI`, `HASNA_*`, `AWS_*`, `AZURE_*`, `GCP_*`, `VAULT_*`, `MEMENTOS_*`, `DATABASE_URL` variants). The deny list applies even when a caller passes `process.env` explicitly.
- **MCP SSE binds 127.0.0.1 by default (P1-2).** The SSE server previously bound without a hostname (wildcard) with no auth, so any reachable host could drive every hook tool. Non-loopback now requires an explicit opt-in host AND an auth token (`HASNA_HOOKS_MCP_TOKEN` / `HOOKS_MCP_TOKEN`, env-only) and is refused without one; with a token, every `/sse` and `/messages` request must present it.
- **Hook event logs are redacted (P1-3).** `tool_input`, `error` and `metadata` were stored verbatim (truncated only) and returned by the MCP log tools and `hooks log`. A write-time projection now redacts secret-typed JSON keys and known credential shapes (`sk-…`, GitHub token forms, `AKIA…`, JWTs, private keys, `key=…` literals) before persistence, so nothing sensitive lands in `hook_events` or the remote sync store; a read-time projection scrubs rows stored by older versions (truncate-on-read; no destructive backfill command).
- **Registry versions are immutable (P1-4, bug d3b4025c).** D1 keeps a new `hook_versions` table keyed (name, version); the `hooks` table is the latest pointer. PUT never overwrites an existing (name, version): a byte-identical republish is idempotent, a conflicting one is a 409. GET `/api/v1/hooks/:name/:version` serves any published version, and catalog + lock expose `versions[]`. `hooks install/update <name>@<version>` fetches the exact pinned version (older-than-latest included), verified against the registry's per-version sha header.
- **PG TLS is verified by default (P1-5).** `sslmode=require`/`ssl=true` previously produced `rejectUnauthorized: false` — encryption with no verification. Verified TLS is now the default; `HASNA_HOOKS_PG_INSECURE_TLS` / `HOOKS_PG_INSECURE_TLS=1` is the only way to disable verification and is refused under `NODE_ENV=production`.
- **MCP preview timeouts never approve (P1-7).** A timed-out `hooks_preview` returned `decision: "approve", timedOut: true` — a stalled guard was silently skipped. Timeouts now block with the timeout reason.
- **`hooks serve` has no `--api-key` value flag (P1-8).** A secret on a CLI flag is visible in process listings and shell history; the publish key resolves from `HASNA_HOOKS_API_KEY` / `HOOKS_API_KEY` only. The vault-key-NAME reference option on `hooks init` is unchanged (a name, not a value).
- **Malformed hooks.lock fails closed (P1-9).** A broken lock used to read as `{hooks:{}}`, so the next sync re-trusted everything. It now throws with a repair message and leaves hooks in the refuse-to-run state; lock writes are atomic (temp + rename).
- **URL hook installs refuse redirects (P2-14).** Both the manifest fetch and the script fetch use `redirect: "error"` — a redirecting URL can end on an attacker-controlled origin serving different bytes than the URL named.

### Changed

- **`hooks sync` commits atomically (P1-9).** Artifacts are staged and fully validated first (network, sha, manifest, containment); the commit then writes all hook files, then all lock pins in ONE atomic write, then the DB records in one transaction. A mid-sync failure leaves the lock and DB untouched and new files unpinned — trust refuses until the sync completes.
- **PG storage accepts `SubagentStart` (P1-6).** The PG `event_type` CHECK omitted the event the SQLite schema supports, so push/pull rejected those rows; an idempotent appended migration adds it (verified against a real local PostgreSQL).
- **Shared semver across manifest, serve and worker routes (P2-10).** Pinned prerelease/build versions (`1.2.3-beta.1`, `2.0.0+meta.5`) validate and fetch everywhere — the routes previously 404'd what validation accepted.
- **`hooks_setup` passes agent_type through to the installer target (P2-12).** A gemini setup registers hooks in the gemini settings, not the claude settings; unsupported types are rejected.
- **CLI error exit codes (P2-13).** `install --category` with an unknown category, `info`/`docs` for an unknown hook, and `doctor` with error-severity findings all exit non-zero.
- **`hooks doctor` reports the bounds of its verdict (P2-16b).** The bare "All hooks healthy!" claim is replaced by the checked counts: registered `hooks run` entries vs raw settings wiring entries, with direct-path wiring explicitly out of the covered surface.
- **`hooks sync --dry-run` reports dryRun (P2-16a).** The dry-run path no longer hardcodes `dryRun: false` — `planSync` and the CLI output emit `dry_run: true` and never print "✓ Synced".
- **Codewith uninstall resolves the operation's own scope (P2-15).** A project-scoped uninstall edits the project's `config.toml`; the global env override applies to the global scope only.
- **Manifest `script_kind` discriminator (P2-14).** `script_kind: "inline" | "file"` removes newline-guessing; absent, the legacy newline heuristic still applies to older manifests.
- **Package validation smoke-tests the extracted tarball (P3-17).** `validate:package` now runs the packed artifact: CLI `--help`, `serve /health`, an MCP stdio initialize handshake, a runtime SDK import and one bundled-hook run.

### Fixed

- **Event-log redaction covers current credential formats (round-2A P1-1).** The shape patterns now catch the formats the first pass missed: OpenAI project/service and Anthropic key forms, Stripe test/live restricted and secret key forms, fine-grained GitHub PATs, `Bearer <token>` as a unit (never the word "Bearer" alone), URL-embedded credentials (`scheme://user:pass@host`), and spaced/quoted/multiline `key = value` pairs. Matching is anchored to the WHOLE credential; the projection is shared between the write path (persistence) and every read path (log tools, `hooks log`, storage pull AND push).
- **Registry installs honor `script_kind` (round-2B P1-2).** The registry sync and exact-pin fetch paths used the newline heuristic, so a one-line inline hook via a versioned registry wrote a file named after the script content and failed with ENOENT; they now share the same script-kind resolution as URL installs, and `hooks serve` passes `script_kind` through the artifact manifest.
- **`hooks install` exits non-zero on a mixed install (round-2B P2-7).** A partial failure (some hooks registered, some refused) previously exited 0; it now exits 1 with the failure count in both output modes.
- **Explicit older pins are preserved across syncs (round-2B P2-9).** `hooks install/update <name>@<version>` marks the lock pin as explicit; a later sync no longer silently bumps a pinned older version to the latest — only an explicit update moves it.
- **CLI pins use the shared semver pattern (round-2B P2-8).** The CLI duplicated a divergent regex that rejected prerelease+build combinations (`1.2.3-beta.1+meta`) that the rest of the stack accepts.
- **Storage push projects unredacted legacy rows (round-2A P2-3).** Rows written before the redactor are scrubbed before forwarding to PostgreSQL, matching the pull/read projection.
- **Worker publish ordering and healing (round-2A P2-4).** The version-row INSERT precedes the R2 write — a concurrent loser 409s before touching R2 (no artifact mismatch), an R2 failure rolls the row back (no partial state), and a crash between insert and latest-pointer upsert heals on the next catalog/lock read or idempotent republish.
- **PG `sslmode` is parsed, not substring-scanned (round-2A P3-12).** `sslmode = require` (spaced), other casings, percent-encoding and DSN forms all resolve; `disable`/`allow`/`ssl=false` never enable TLS.
- **Hook env deny list widens (round-2A P3-11).** `MEMENTOS_*` and the `*_URL`/`*_URI` name classes are denied alongside the existing classes — a URL-bearing variable can embed credentials.
- **`hooks doctor` reports its bounds in every branch (round-2B P3-10).** With zero registered hooks the checked-0-of-N wiring line is still printed, so a direct-wired settings file cannot read as "nothing to check".
- **Registry staging verifies the manifest version (round-2A P3-13).** An artifact whose manifest declares a different version than the versioned row it was served from is refused, matching the exact-pin fetch path.

## [0.6.5] - 2026-08-15

### Fixed

- **Timeout kills target the whole process group.** Measured on station02: Bun's `process.kill(-pid)` returns without error and does nothing, and the machine's Landlock signal-scope domain silently blocks negative-pid group kills even via `/usr/bin/kill -9 -pgid` (rc=0, no effect). `killGroup` now enumerates the hook's process group from /proc and SIGKILLs every member by positive pid, then the leader — on both the timeout path and the post-exit drain path. A hook's children can no longer outlive it with PPID=1 (bug 4d4c8f0b). Verified through the real stdio MCP server with pgid-based probes (earlier name-based probes were vacuous: `ps comm` is `sleep`, not `sleep 300`).

## [0.6.4] - 2026-08-15

### Security

- **Registry fetches refuse redirects.** `fetchJson` now uses `redirect: "error"`, so the `x-api-key` header can never follow a 3xx to another origin (measured live: the key followed a 302). Same-origin and cross-origin redirects both refuse, fail-closed.
- **Pinned-version integrity.** `hooks install/update <name>@<version>` verifies the artifact sha against the remote lock AND the manifest name/version against the request before writing; the pin and DB record always carry the VERIFIED digest — a post-write re-read that differs refuses instead of being trusted.
- **Timeout bounds are real.** MCP `timeout_ms` is validated as a positive integer capped at 600000; `0`/negative/over-max are rejected, never interpreted as "no timeout". A manifest or SDK `timeout_ms: 0` is likewise never a real value (SDK treats non-positive options as not provided).

### Fixed

- **`hooks remove` is a full uninstall** (QA-1 BUG-A / QA-4): resolves custom, registry-synced and bundled hooks; removes the settings registration (claude + gemini), the Codewith TOML entry losslessly, the store dir, the lock pin and the DB record. A store dir that cannot be removed keeps the trust records intact and fails closed (no fail-open retrust). Nonexistent hooks exit non-zero in both output modes.
- **`hooks log` works** (bug ef58dcb7): every execution — CLI run, SDK `runHook`, MCP run tools — writes a `hook_events` row with name, event, result, exit, timestamp and version+sha metadata; timeouts and `SubagentStart` runs are recorded too (schema + migration 005).
- **SQLITE_BUSY under concurrent runs** (QA-4 bug 09094299): `PRAGMA busy_timeout=5000` is set immediately after open; 10 parallel runs all succeed.
- **MCP run tools** (QA-4 bug 4d4c8f0b): reach custom/registry hooks (bundled-catalog gate removed); honor the manifest `timeout_ms`; spawn in a process group and kill the group on timeout — no orphaned children; bounded pipe drain so a backgrounded child cannot hang a run.
- **Install fail-closed reporting** (QA-3 P2 / QA-1 BUG-C): `hooks install` exits non-zero with "Nothing was registered" and never claims "Registered in …" when every hook was refused.
- **Version pin at install** (QA-1 P3): custom installs pin the actual installed version+sha immediately; a pin failure rolls back the copied store dir so bytes never become runnable unrecorded.
- **`hooks list`** (QA-4 A1, bug e8461f89): surfaces custom/registry hooks with versions and sources alongside the bundled catalog; `-i/--installed` includes them.
- **`hooks update`** fails closed: no installed hooks, or any requested update failing, exits non-zero in both output modes.

### Changed

- `hooks init --cloudflare` always writes `api_key_ref` (vault key NAME, default `hasna/hooks/live/api-key`) into config.json (QA-3 deviation).
- `hooks install <name>@<version>` parses pins strictly: only bare names + semver are pins; URLs and local paths are always custom sources.

## [0.6.3] - 2026-08-14

### Fixed

- **`hooks run` executes .sh hooks under bash** (bug e0cd726c): `executeVerifiedScript` unconditionally spawned `bun run <tempfile>`, and bun's parser is a partial bash subset that rejects real bash (measured on env-dump-guard: `Unexpected ')'` on escaped-paren regexes). The runner now picks the interpreter from the verified bytes — a recognized shebang wins (`bash`/`sh` → `/bin/bash`, `node`/`bun` → bun), otherwise `.sh`/`.bash` run under `/bin/bash` and known JS/TS extensions under bun; unknown extensions and unknown shebangs are refused with an error naming them. The temp-file extension follows the interpreter (bun routes by extension, so a node-shebang `.sh` file gets a `.ts` temp name). The verified-bytes property is unchanged: the temp file still holds exactly the hashed content, read-once-verify-execute, and hash refusal now covers `.sh` hooks too.

## [0.6.2] - 2026-08-14

### Changed

- **Registry privacy lock-down.** When the worker `HOOKS_API_KEY` binding is set, every registry route except `/health` requires a valid API key (`X-API-Key` or `Bearer`); `/health` stays open for probes. Without the binding, reads stay open — the behavior is config-driven, preserving the OSS default.
- API key comparison is now timing-safe (`secureEqual`, constant-time) instead of a plain string compare.

### Fixed

- **Bundled-hook runtime resolution** (bug 3e69199c): a hook installed at runtime from the bundled set now resolves to its own bundled copy instead of failing or resolving to the wrong location.
- **`hooks doctor` matcher fix**: hook matching no longer misclassifies hooks when matching against the registry.

## [Unreleased]

### Added

- Added unit coverage for SQLite/PostgreSQL storage synchronization and one-time legacy flat-file imports, including empty, malformed, and permission-refusal paths.

### Changed

- **BREAKING: deployment modes are gone; hooks storage is a two-value data-backend switch.** `StorageMode = "local" | "hybrid" | "remote"` described _where_ something ran, which was never a property of the data layer, and nothing in the codebase ever branched on it — it was reported by `hooks storage status` and the `storage_status` MCP tool and otherwise decorative. It is replaced by `StorageBackend = "sqlite" | "postgresql"`.
  - `HASNA_HOOKS_STORAGE_MODE` and `HOOKS_STORAGE_MODE` are retired and are **no longer read**. Setting either now raises an error naming the replacement variable and the backend to use, instead of being quietly ignored: `local` became `sqlite`, and `hybrid` / `remote` / `self_hosted` / `self-hosted` / `cloud` all became `postgresql`.
  - New `HASNA_HOOKS_STORAGE_BACKEND` (fallback `HOOKS_STORAGE_BACKEND`) accepts `sqlite` or `postgresql` (`sqlite3`, `postgres` and `pg` are accepted aliases). **An unrecognised value now throws.** Previously any unknown value — including a typo — fell through `normalizeStorageMode` to `undefined` and then silently to `local`, so a misconfigured mode looked like a working local one. That silent normalisation was the actual defect; the vocabulary was its symptom.
  - Backend inference is unchanged: with the variable unset, a configured `HASNA_HOOKS_DATABASE_URL` / `HOOKS_DATABASE_URL` yields `postgresql` (previously reported as `hybrid`) and its absence yields `sqlite` (previously `local`).
  - `StorageStatus.mode` is renamed to `StorageStatus.backend`, and `hooks storage status` prints `Backend:` in place of `Mode:`. Removed from the package's public exports: `StorageMode`, `getStorageMode`, `HOOKS_STORAGE_MODE_ENV`, `HOOKS_STORAGE_MODE_FALLBACK_ENV`, `STORAGE_MODE_ENV`. Added: `StorageBackend`, `getStorageBackend`, `STORAGE_BACKENDS`, `HOOKS_STORAGE_BACKEND_ENV`, `HOOKS_STORAGE_BACKEND_FALLBACK_ENV`, `STORAGE_BACKEND_ENV`, `RETIRED_STORAGE_MODE_ENV`.
  - Hook evaluation is untouched: no hook, and no part of the prompt path, reads the backend. `getStorageBackend()` is reached only from `getStorageStatus()`.

### Fixed

- **`pre-bash` / `worktree-guard` destructive-shell guard no longer lets a filesystem-root wipe through.** `rm -rf /*` and `rm -rf "$(cmd)"/*` both returned `{"continue":true}` before this change; only `rm -rf /` blocked, and only incidentally, because `~/.hasna` sits under it. Two complementary rules close the class:

  - **System roots are protected.** `/` and the FHS/macOS system directories (`/usr`, `/etc`, `/bin`, `/lib`, `/var`, `/boot`, `/home`, `/Users`, …) are now protected roots in `root` mode, so wiping a root or its contents blocks while a targeted delete beneath one (`rm -rf /usr/local/lib/my-build`) still passes. Extend per machine with `HASNA_PROTECTED_SYSTEM_ROOTS`. `/tmp` is deliberately excluded.
  - **Expansions that can collapse to empty are blocked by shape.** Every destructive target containing a command substitution, backtick substitution or variable expansion is re-checked as the shell would render it if the expansion came back empty. `rm -rf "$(anything)"/*`, `` rm -rf `cmd`/* ``, `rm -rf "$VAR"/*` and `rm -rf "${VAR}"/*` all block regardless of what the expansion is. `${VAR:?}` is exempt — POSIX guarantees it non-empty. The bare `rm -rf "$(cmd)"` form (no trailing separator) stays allowed: it degrades to `rm -rf ""`, which rm rejects without deleting anything.
  - A wholesale content glob (`dir/*`) is now matched against protected roots nested _under_ `dir`, not just against `dir` itself. This is the asymmetry that let `rm -rf /*` through while `rm -rf /` blocked. Narrower globs (`dir/build-*`) keep their previous, weaker check.
  - Wrapped and relocated commands are unwrapped before scanning: `bash -c`/`sh -c`/`zsh -c`, `su -c`, `runuser -c`, `eval`, and `ssh host '…'` including nested combinations. Remote layers only consider absolute targets, since a remote relative path cannot be resolved locally.
  - `cd` is tracked within a command, so `cd / && rm -rf *` and `cd "$(cmd)"/ && rm -rf ./*` block.
  - A `for VAR in <root-glob>` binding is followed into `rm -rf "$VAR"`.
  - Block messages now name a safe alternative instead of only refusing.
  - Glob targets are matched per path component, so a trailing literal bounds the delete: `rm -rf */node_modules` at a monorepo root is allowed while `rm -rf /*/*`, `rm -rf /*/bin` and `rm -rf /home/*/.hasna` are not. A glob directly under a protected root is refused only when _unanchored_ — no literal text survives once wildcards are removed — so `[a-z]*`, `?*`, `.??*` and `*.*` block while `*.log`, `tmp-*`, `.turbo*` and `snapshot-[0-9]*` are allowed.
  - Bracket expressions the matcher does not model exactly (POSIX `[:class:]`, `[=equiv=]`, `[.collate.]`, backslash escapes, unterminated) are treated as matching rather than as not-matching. An under-match leaves a protected root unmatched and allows the delete.
  - Working-directory tracking covers `cd`, `cd -`, `pushd`, `pushd -n`, `popd` and a per-subshell directory stack; a `cd` in a subshell or pipeline stage no longer escapes it.
  - The non-empty guarantee used by the expansion rule is withdrawn by `unset`, by `export`/`declare`/`typeset`/`readonly`/`local` assignments, by `read`/`getopts`/`mapfile`/`printf -v`, by `for NAME in`, by `declare -n` namerefs, and entirely by `eval`/`source`/`.`/`trap`/`coproc` and arithmetic assignment. `export X` with no value does not withdraw it.
  - A glob in **any** path component counts, not only the last: `rm -rf /*/*` destroys `/usr/*`, `/etc/*` and `/home/*` and is now blocked. A bounded glob (`~/proj*/dist`, `/var/log/*.gz`) keeps its narrower check and stays allowed.
  - Brace alternations are expanded, so `rm -rf /{bin,etc,home}` is seen as the root deletes it performs.
  - Command-substitution **bodies** are scanned as scripts: `echo $(rm -rf /)` runs the delete and discards only its output.
  - `cd` inside `( … )` or a pipeline stage no longer moves the guard's working directory, and `cd -` returns to the previous one.
  - Expansion nesting has no depth limit (`$(dirname "$(dirname "$(cmd)")")`, `${A:-${B}}`), and expansions the shell cannot return empty — `$(pwd)`, `$PWD`, `${VAR:-nonempty}`, and variables assigned a non-empty literal earlier in the same command — are not treated as collapsible.

  Remediates the 2026-07-24 data-destruction incident in which `rm -rf "$(bun pm cache)"/*`, sent over ssh inside `bash -c`, ran as `rm -rf /*` (`bun pm cache` exits non-zero with empty stdout when no `package.json` is found walking up from cwd), freeing ~700 GB and permanently destroying one repository's only source copy.

## [0.4.1] - 2026-07-26

### Fixed

- `worktree-guard` / `managedWorktreeInfo()` now classify worktrees against the canonical path shape from Hasna Agent Operating Rules rule 8, as published by the `@hasna/identities` 0.4.4 global agent rules: `$HOME/.hasna/repos/worktrees/<repo-name>/<worktree-name>`. The guard previously required a 3-segment `<station-id>/<repo-slug>-<hex>/wt_<hex>` lease layout, so every rule-8-compliant worktree was classified UNMANAGED — blocking `git commit`/`git push` from it, and denying it the scoped `~/.hasna` write carve-out so that `Write`/`Edit`/`apply_patch` into a canonical worktree was blocked as a dangerous operation.
- Non-canonical shapes are now rejected with a specific reason instead of a generic "not deep enough": flat single-segment worktrees under the worktrees root, station-id/machine segments in front of the repo name, and nesting deeper than the canonical shape. Subdirectories of a canonical worktree are correctly accepted.
- The restored `~/.hasna` write carve-out covers canonical paths that are _linked_ git worktrees. A canonical path holding a standalone clone (a `.git` directory) is now allowed to `git commit` but still cannot be written to by file tools, because the carve-out's anti-forgery proof requires linked-worktree provenance. That proof is deliberately unchanged; on the reference fleet this affects 38 of 203 accepted paths, which should be created with `git worktree add`.
- Classification is grounded in verified git provenance, not path shape. A path is canonical only if it is a real worktree root, no segment is a symlink, and its `.git` proves ownership of its own history — a `.git` file's `gitdir:` target must live under its repository's `worktrees/` directory and point back at this control file, and a `.git` directory must be self-contained, with no `commondir` and with real `objects`/`refs` of its own. Without those proofs, `<worktrees-root>/<flat-worktree>/<subdir>` let a single `cd` launder a forbidden flat worktree into a compliant one, and a symlink, a two-line forged `.git` file, or a `.git` directory with symlinked object storage pointed a compliant-looking path at a shared checkout, so `git commit`/`git push` landed on that checkout — exactly what rule 10 forbids. The same grounding gates the deprecated-layout tolerance, so its name pattern cannot be used as a forgery kit.
- Hook verdicts are written synchronously. `process.stdout.write` is asynchronous on a pipe, so a verdict larger than the pipe buffer could be truncated when the hook exited, and a truncated verdict is unparseable — the caller would see no decision at all.
- On the reference fleet the guard's verdict now agrees with git's own verdict for 207 of 207 canonical-path checkouts: every path it rejects is one where `git` itself refuses to operate (pruned or half-pruned worktrees), and every path it accepts is one where git works.
- Repo and worktree path segments are no longer restricted to an allowlist that rejected legal directory names (long names, `+`, `~`, spaces, non-ASCII). Segments are bounded by the filesystem limit and still refuse a leading `.` or `-` and control characters.
- Guard messages cite the canonical path template and the rule-8 remediation (`git worktree add` at the canonical path, then `repos scan`) instead of the stale `repos worktrees claim` command; the repos CLI has no worktree verb.
- The `<repo-name>` segment in guard remediation is now resolved with the exact repos CLI lookup rule 8 mandates (`repos repo --remote <host/org/name> --json`), falling back to the local checkout directory. It was previously derived from the git remote basename, which names a _different_ directory for 46 of 50 indexed repos (`open-hooks` is `github.com/hasna/hooks`), so the guard used to point agents at a path that does not exist. The suggested base branch now comes from the repo's real `default_branch`. The lookup is best-effort: a missing or failing repos CLI degrades to local information.
- Worktree/repo path segments may start with an underscore (e.g. `connectors/_base`), while a leading `.` or `-` is still refused.

### Deprecated

- The pre-rule-8 station-id lease layout `<station-id>/<repo-slug>-<hex>/wt_<hex>` is no longer a compliant worktree shape and is reported as unmanaged with a migration reason. Two scoped, temporary tolerances keep existing worktrees usable while they are re-homed: git work there warns instead of being blocked, and the layout is retained read-only for the scoped dangerous-operation carve-out so it keeps its `~/.hasna` write exemption. Set `HASNA_HOOKS_LEGACY_WORKTREE_TOLERANCE=0` to turn both off once those worktrees are re-homed; the branch is removed after that. While the tolerance is on it keys off the path name, so a worktree deliberately named to match also gets the warn tier — an opt-out from a guardrail, not a hole in the provenance proof, which applies to both tiers. The write carve-out's own verification is unchanged: standalone repos, forged worktree metadata, symlink/hardlink escapes, and Git metadata targets still fail closed at either depth.

  Measured against the 764 real worktrees on the reference fleet machine, the guard's verdicts move as: 189 block → allow (rule-8-canonical worktrees that 0.4.0 wrongly blocked), 70 allow → warn (station-id lease layouts, now on the migration path), 502 block → block (already non-compliant), and 3 allow → block. Those 3 are worktrees whose repository has been pruned, where `git` itself already refuses to operate, so no working setup is stranded by the change.

## [0.4.0] - 2026-07-24

### Added

- Gradual-disclosure output flags on the CLI: `--limit`, `--all`, `--verbose` (alongside existing `--json`), plus `hooks info <name>` and `hooks docs <name> --verbose` for full detail on demand (#2).

### Changed

- Compact output by default across noisy surfaces: `hooks list`, `hooks search`, `hooks docs`, and log list/search/tail/errors now render capped, scannable summaries with hints to the detail paths. MCP list/search/docs/registered/profile/log/agent tools are also compact by default, with explicit `compact:false` / `verbose:true` escape hatches. Machine-readable `--json` paths remain full detail, and the legacy 50-row default for full MCP log rows is preserved (#2).

### Fixed

- Cross-cwd managed worktree patches: recognize absolute file-tool targets inside a different verified linked managed worktree, while failing closed for malformed/standalone repos, Git metadata, roots, symlink/hardlink escapes, and forged worktree provenance; managed-root discovery is cached across multi-file patches (#7).

## [0.3.11] - 2026-07-20

### Fixed

- `fleet-blockers-gate`: made the brake owner-scoped and reliable. It now denies mutating tools on a real code-flagged blocker (`blocking=1`) returned by `conversations blockers` — the correctly-retrieved, tamper-resistant signal — instead of scanning message text for `[FREEZE]`. Freeze TEXT in channels is now informational and never stops work, killing the phantom-freeze bug where any `[FREEZE]` string from any author wedged the fleet; and a real `blocking=1` blocker that lacked `[FREEZE]` text is no longer ignored.
- Author (`from_agent`) is unauthenticated, so it is treated as advisory context in the deny reason only and is never used as a security gate (avoids false assurance from a spoofable field).
- Raised the per-check exec timeout default from 500ms to 1500ms: the `conversations` CLI has a ~0.5s cold start, so the old budget flaked and the gate silently failed open.
- Hardened the CLI invocation (`execFileSync` with an argument array plus a leading-dash/shell-metacharacter guard) and made the freeze state engage fast while disengaging slowly via an asymmetric TTL cache.

## [0.3.10] - 2026-07-13

### Fixed

- Allowed normal child cleanup and file edits inside the current git repo root under managed `~/.hasna/repos/worktrees` paths, including fallback-shaped worktrees, while still blocking managed repo root wipes, managed worktrees root wipes, protected Hasna state, workspace roots, Hasna scope roots, and active roots.

## [0.3.9] - 2026-07-13

### Added

- Added scoped dangerous-operation blocking for Codewith-native `pre-bash` and `worktree-guard` surfaces covering protected Hasna state, workspace roots, active repo roots, and managed worktrees without banning ordinary cleanup like `rm -rf dist`.
- Added Codewith apply-patch tool coverage for `apply_patch`, `ApplyPatch`, and `functions.apply_patch` payloads, including canonical `tool_input.command` patch bodies.

### Changed

- `hooks install --target all` now excludes obsolete Gemini and targets the active supported agent set.

## [0.3.8] - 2026-07-10

### Changed

- Removed the standalone npm package manifest for `knowledge-context`; the hook is now distributed only inside `@hasna/hooks`.
- Kept `knowledge-context` available as a catalog hook via `hooks run knowledge-context`.

## [0.3.7] - 2026-07-09

### Fixed

- Filtered `knowledge-context` matches that mark themselves as historical/reference-only or not suitable for auto-loading, preventing archived startup files from being injected into normal agent context.
- `knowledge-context` now fetches extra bounded candidates internally while still rendering only the configured top item budget, so filtering stale matches can reveal useful Knowledge without bloating context.

## [0.3.6] - 2026-07-09

### Changed

- Compact `knowledge-context` citation output further by printing the full-item read command once and formatting Knowledge bullets as `item_id=... cite=...`.
- Added deterministic high-signal gating for `UserPromptSubmit` so low-signal prompts fail open instead of injecting Knowledge matches on every short user message.

## [0.3.5] - 2026-07-09

### Fixed

- Fixed `knowledge-context` helper imports so importing exported helpers does not trip the executable-entrypoint guard.

## [0.3.4] - 2026-07-09

### Changed

- Reduced `knowledge-context`'s default context pack budget to the top 3 items to keep hook-added context compact.
- Compact Knowledge citation output by omitting repeated `knowledge://item/...` source URIs when the `knowledge get --id ... --json` follow-up command already identifies the item.

## [0.3.3] - 2026-07-09

### Changed

- Improved `knowledge-context` progressive context output by surfacing Knowledge citation previews as bounded blurbs and adding `knowledge get --id ... --json` read hints for full-item follow-up.

## [0.3.2] - 2026-07-09

### Changed

- Raised `knowledge-context`'s default Knowledge CLI timeout to 5000ms and generated Codewith hook timeout to 6s so deterministic context packs can finish reliably by default.

## [0.3.1] - 2026-07-09

### Added

- `knowledge-context` catalog hook for Codewith `SessionStart`, `UserPromptSubmit`, and `SubagentStart` context injection using deterministic `knowledge context pack --from search` reads
- Codewith installer target support via `--target codewith`, emitting renderer-safe TOML fragments by default and writing Codewith config only with an explicit `--apply-codewith --codewith-config <path>`
- Multi-event registry metadata so one hook can register across multiple lifecycle events

### Changed

- Extended hook event typing with Codewith `UserPromptSubmit` and `SubagentStart` lifecycle events while preserving existing Claude/Gemini target behavior

## [0.3.0] - 2026-07-06

### Added

- SessionStart and SessionEnd hook events across the catalog, schema, installer, and docs (fleet comms Phase 0)
- `fleet-catchup` hook (SessionStart): injects unread blockers, channel notifications since last catchup, and the bounded announcements digest into agent context — deterministic CLI reads, fail-open
- `agent-rules-version-check` hook (SessionStart): compares the rendered `hasna:agent-operating-rules` sentinel version against configs state and warns on drift
- `fleet-blockers-gate` hook (PreToolUse): denies mutating tools while an unread `[FREEZE]` blocking message is active — TTL-cached, hard 500ms fail-open timeout
- SQLite migration `002_session_events` rebuilding the `hook_events` CHECK constraint (with PostgreSQL parity statements)
- `isEventSupported()` installer API; installs for targets without a session-event surface (Gemini) fail with a clear error instead of writing dead settings keys

### Changed

- `announce-start` rebound from Notification (which never fired at session start) to SessionStart; context now injected via `hookSpecificOutput.additionalContext` (0.2.0)
- Reinstalling a hook now removes its entries from every event key, migrating settings entries when a hook is rebound to a new event

### Fixed

- Hyphenated hook names (`announce-start`, `dm-inject`, `typecheck-gate`, …) were invisible to `list --installed`, `remove`, and `doctor` due to a `\w+`-only command regex
- Shell-unsafe values from env/hook input are no longer interpolated into announce/catchup CLI commands

## [0.1.1] - 2026-02-14

### Changed

- Multi-agent support, remove brand-specific mentions

## [0.1.0] - 2026-02-14

### Added

- Update registry to 30 hooks across 10 categories
- 15 new hooks across 5 new categories
- 253 tests with 1,023 assertions across all modules
- MCP server for AI agent integration
- CLI with interactive UI and non-interactive commands
- Core library with registry and installer
- 15 initial hook packages
- Initial project setup

[0.3.10]: https://github.com/hasna/hooks/compare/v0.3.9...v0.3.10
[0.3.9]: https://github.com/hasna/hooks/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/hasna/hooks/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/hasna/hooks/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/hasna/hooks/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/hasna/hooks/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/hasna/hooks/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/hasna/hooks/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/hasna/hooks/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/hasna/hooks/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/hasna/hooks/compare/v0.1.1...v0.3.0
[0.1.1]: https://github.com/hasna/hooks/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hasna/hooks/releases/tag/v0.1.0
