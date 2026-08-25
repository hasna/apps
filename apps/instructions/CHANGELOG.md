## 0.5.2

### Patch Changes

- 3298e2f: instructions-serve answers --help/-h before any bind (todos row c8067fdd, O15-00628). Previously `instructions-serve --help` fell through to the Hono app export and bound :3457, printing "instructions-serve listening on …" and serving forever with no help output.
- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.5.1

### Patch Changes

- 3298e2f: instructions-serve answers --help/-h before any bind (O15-00628, hasna/apps#1124)
- d92f7c6: recognize a registered agents-md config as owned claude-home authority (hasna/apps#1129)
- 593ca2e: refresh the embedded operating-rules fallback baseline to v1.1.26 (hasna/apps#1152)

## 0.5.0

### Minor Changes

- e91a13c: feat: per-endpoint provider-context injection for coding-agent harnesses (task 2500c381, ask-fable ruling 2026-08-24). New `instructions provider-context resolve` command resolves the effective endpoint (from `$ANTHROPIC_BASE_URL` / `--endpoint` / Codex `model_providers`) against an explicit origin registry (deepseek-anthropic, openrouter-cc, openrouter-codex, anthropic-native), renders exactly ONE bounded identity fragment into `<home>/.hasna/provider-context/<key>.md` plus a sha256 manifest, and emits a per-launch audit line. Unknown endpoints exit non-zero with a named reason and render the invariant fragment, so a lane never runs with zero identity context. Fixes the owner-reported bug where Claude Code launched against DeepSeek's Anthropic-compatible endpoint fabricated Claude-Code model identity ("it doesn't know it's deepseek and it's using the claude code models"). Nothing is generated or fetched at launch; fragments tell the agent to read its own env/config (no rot-prone hardcoded model catalogs). No credential values. Companion skill wiring (claude-code-deepseek / claude-code-openrouter / codex-openrouter) injected at launch via `--append-system-prompt-file` (Claude) or task-prefix envelope (Codex).

### Patch Changes

- 4127f83: feat: global station-profile injector (owner request 2026-08-24). New `instructions station-profile refresh|show|path|preview` commands generate a compact (<600 B) per-station block — station id/name, hostname, platform/arch, user, home, workspace, best-effort live status, and installed @hasna/_ + @hasna-internal/_ package counts (top-N names) — cached at `~/.hasna/instructions/station-profile.md`. Every `session plan`/`session apply` now injects the cached block as a machine-layer source by default (opt out with `--no-station-profile`); renders without a cache are byte-identical to before. Idempotent refresh (writes only on change), additive (never touches existing files), no secrets, macOS + Linux safe.
- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.4.43

### Patch Changes

- 8b70821: instructions-mcp/configs-mcp answer --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `configs-mcp --version`/`--help` fell through to the shared Streamable HTTP server and bound :8853 with no output.

## 0.4.42

### Patch Changes

- 10b1285: Wire the recommended `keyStatus` hook (`ApiKeyStore.keyStatus` from @hasna/contracts/auth) into both /v1 auth construction sites in the serve wiring (`getCloudVerifier` and `getHonoAuthMiddleware`), replacing the deprecated `isRevoked`-only wiring (row 67e30a56, incidents 720505/720506). The contracts auth verifier fails closed at construction when wired with `isRevoked` only — that form cannot refuse a key this service has no record of, so an unregistered key is irrevocable — and the /v1 API 503'd every request, failing the station01 instruction-delivery check across all 30 homes and making `instructions list` exit rc=1. The keyStatus hook refuses unknown, revoked and expired keys; regression tests prove both construction sites wire the hook and that the hook denies revoked keys, accepts active keys and refuses unregistered (unknown) keys.

## 0.4.41

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.1 (the pinned @hasna/contracts version). Todos d175d558.
  - @hasna/contracts@0.13.3

## 0.4.40

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.4.39

### Patch Changes

- Wire the canonical data root (`~/.hasna/instructions`, overridable via `HASNA_CONFIGS_HOME`) into the shipped local storage paths: the SQLite store and the CLI's db-path and backup computations now derive from `getRawStoreRoot()` instead of a hardcoded `~/.hasna/instructions`, and the README documents the default (was stale `~/.hasna/configs`).
- @hasna/contracts@0.13.1

## 0.4.38

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.4.37

### Patch Changes

- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

## 0.4.36 (2026-08-15)

### Fixed

- **cursor-authority**: position-aware `markerPayload` — the stamp/observer
  round-trip now inverts exactly for frontmatter-bearing and marker-quoting
  payloads (PR #164, task ae2c7336). The observer's success return is
  `managed` on main (PR #108); the published 0.4.34/0.4.35 artifacts shipped
  the pre-fix observer and block cursor renders whenever `hasna-global.mdc`
  exists — this release ships the corrected observer + payload handling.

# Changelog

## 0.4.35

Publishes merged PR #119, which releases the mode-removal content from PR #111
(removing the deployment-mode vocabulary per the canonical doctrine). The
release carries the exact merged main tree at `918cbc03`.

## 0.4.34

Fixes the Cursor fixed global-authority guard blocking every cursor session
render (todos `1a3e8689`): the guard now recognizes the package's own apply
output (a managed marker with a valid payload hash) as managed, and the apply
path stamps that marker onto every write to `.cursor/rules/hasna-global.mdc`.
Foreign, tampered, and non-regular files remain blocked. `session plan` also
exits non-zero when the render plan is blocked instead of returning rc=0 with
an empty plan.

## 0.4.33

Publishes merged PR #96, which restores legacy profile follow-up reads when
canonical profile routes are unavailable. The release carries the exact merged
main tree at `2781bc8`.

## 0.4.32

Publishes merged PR #94, which restores stale profile follow-up resolution
after a profile lookup recovers through the complete remote source. The
release carries the exact merged main tree at `4e58d8c`.

## 0.4.31

Publishes merged PR #92, which fixes remote profile resolution so profile
lookups use the complete bounded source rather than stopping at the default
page. This keeps profile selection correct when the remote store contains more
profiles than the first response page.

The registry's 0.4.30 artifact was published before PR #92 merged. This
release carries the exact merged main tree at `56416db` to the registry.

## 0.4.30

Publishes the merged compiler and provider-surface work from PRs #88, #89,
and #90.

PR #88 adds profile instruction-graph compilation with durable profile/config
bindings, graph-aware apply planning, and the associated CLI, API, migration,
and storage contracts.

PR #89 adds version-aware provider render adapters so provider capabilities are
selected from the declared runtime/version surface rather than inferred from a
single unversioned path.

PR #90 adds the provider-assets pipeline, including asset plans, profile asset
bindings, provider asset adapters, version metadata, and the API/storage
round-trip needed to render those assets through the same managed compiler.

The published 0.4.29 artifact predates all three merges. This release carries
the exact merged main tree at `9756352f` to the registry.

## 0.4.29

Allows a same-revision Projects v1-to-v2 project-context migration only when a
strict durable v1 cache proves every shared field is unchanged. The migration
may carry producer-valid v2 finance metadata, while reverse migrations,
shared-field drift, malformed finance, unsupported majors, and unproven
conflicts still fail.

## 0.4.28

Corrects the unpublished 0.4.27 project-context v2 bridge by validating and
preserving Projects' optional strict finance metadata. Finance-bearing v2
bundles now survive the cache and session-manifest provenance chain, while
malformed finance metadata and finance attached to legacy v1 bundles fail
closed.

## 0.4.27

Accepts the current Projects `hasna.projects.project_context_bundle.v2`
contract as a schema-compatible reserved project-context input while keeping
v1 accepted and future major versions rejected. Session manifests now preserve
the accepted bundle schema in project-context provenance so managed rerenders
retain the v2 context instead of dropping reserved bytes.

## 0.4.26

Publishes `ff7ac72` (#78), the project-context compatibility bridge.

It accepts external v1 bundles only when their schema and supplied hash are
valid, normalizes accepted legacy bundles to the canonical hash, fails closed
on malformed managed END markers unless forced, preserves adjacent same-line
user bytes, and creates a restorable before-image snapshot for target
mutations.

## 0.4.25

Publishes the two commits currently on `main` after the 0.4.24 npm gitHead:
`9fe30cc` (#74) and `f3784d3` (#76).

`f3784d3` bounds managed source admission before render planning reads a source
or lets a caller-constructed source list enter `session plan` / `session apply`.
That keeps the managed-input capacity guard on the real source list rather than
only on later rendered outputs.

`9fe30cc` updates the seeded Conversations send workflow contract so the
workflow record matches the current Conversations CLI surface.

## 0.4.24

Publishes `0fcb0542` (#72): the renderer now REFUSES to write a managed output
the reader would later refuse, instead of relying on headroom.

0.4.23 raised the read bound on managed outputs to
`SESSION_MANAGED_OUTPUT_MAX_BYTES` (8 MiB) and left the WRITE unbounded, so the
two sides agreed only by luck of corpus size. `planSessionRender` now rejects
any managed output past that bound and warns past half of it.

The refusal is at PLAN time, deliberately. `planSessionRender` writes nothing,
so a refusal has no side effects: the previous home survives intact and merely
stale, and `session plan` / `session apply --dry-run` predict the failure rather
than discovering it mid-write. Refusing inside `apply` would land partway
through per-file atomic replacements and leave the home part-new, part-old with
a manifest describing neither. Truncation was rejected because a silently
shortened instruction home looks complete to every agent that reads it while
missing directives.

The manifest is checked alongside the provider entrypoints, because both are
allowlisted at the same raised bound and both grow with the same corpus; a
render that guarded only the entrypoint would move the identical wedge onto the
manifest.

The path match handles the codewith base mismatch: `SESSION_MANAGED_OUTPUT_PATHS`
is workspace-relative and a render plan's path is target-home-relative, which
for codewith differ by one segment. A direct comparison would guard claude and
codex and silently miss codewith.

Measured against the live corpus at release time: 44 sources render to 298,164
bytes, 28.1x under the bound, largest single source 26,564 bytes — so no single
addition can cross from silent to refused, and the headroom warning is
guaranteed to fire on many renders before the refusal ever can.

Also corrects a false comment claiming `SESSION_MANAGED_OUTPUT_PATHS` is every
path in `projectContextSessionGuardPaths()`. It is deliberately narrower: the
project-context manifest, cache and fragment stay at `FOREIGN_INPUT_MAX_BYTES`.

Known residual, tracked as `OPE15-00068`: a home that is ALREADY oversized stays
unrecoverable through this tool, because planning reads it before it can decide
to replace it. This release prevents the wedge; it does not cure one.

## 0.4.23

Publishes `340aecac` (#69): the renderer no longer writes a managed instruction
home larger than it will later agree to read.

The writer was unbounded at `apply.ts:161` while the reader capped every
observation at 256 KiB via `readUtf8RegularFile`, so a flattening adapter could
emit a home it could not subsequently open — wedging its own next run. Only
flattening adapters were affected; splitting homes distribute the identical
payload across separate files and never approach the bound.

Two bounds are now named instead of one constant repeated in three places:
`FOREIGN_INPUT_MAX_BYTES` (256 KiB, unchanged, for input this tool did not
author) and `SESSION_MANAGED_OUTPUT_MAX_BYTES` for files it does author, with
`managedObservationMaxBytes()` as the single decision point. The fragment read
keeps its 4 KiB bound and the cache its 32 KiB.

Concretely, this release is what the codex home is waiting on: station01's
`$HOME/.codex/AGENTS.md` is 273,860 bytes, generated 2026-08-07T14:47:43Z, and
is four sources behind the claude home's 44. It sits above the 256 KiB read cap
and no published version can repair it.

## 0.4.22

Ships the managed Bash-profile fix from issue #65 and task
`cde9f87b-ff03-45d2-9882-4899f0ba1e8b`.

The canonical `bash-profile` source now stores a readable-file guard for the
optional `$HOME/.local/bin/env` helper. Login shells therefore emit no
missing-file stderr when the helper is absent, while still sourcing it and
preserving its environment initialization when present.

## 0.4.18

Publishes the three source-visibility commits that landed on `main` after the
0.4.17 release commit and had no release of their own. **No behaviour in the
render itself changes in this release** — the collapse and override rules are
byte-identical; what changes is that a discarded source is now reported instead
of vanishing.

**`session plan` / `session apply` now name every source the render discards**
(#50, todos `0c7ffd33`). `deduplicateSemanticPolicySources` collapses every
source whose content carries the `<!-- hasna:agent-operating-rules v=X.Y.Z -->`
sentinel down to one, by priority-then-version, and `composeSources` discards
earlier overridable layers ahead of a `merge:"replace"` source. Both were
silent: `manifest.warnings` and `manifest.skippedSources` existed and neither
was ever populated, so a lost source was invisible in the exit code, the
warnings surface and the manifest alike. Both eviction directions now record
the discarded source **and** the source that superseded it.

The exit status is deliberately still 0. A policy collapse is a legitimate
outcome, and the fleet render runs `session apply` under `set -euo pipefail`
across every profile home — failing hard would abort the sweep mid-flight and
leave a partial render, which is a worse failure than the one being reported.

**Registered `global-*` sources are reconciled against render coverage** (#51),
so a source that is registered but reaches no rendered home is surfaced rather
than assumed present.

**`instructions tag <id> --add/--remove <tag>`** (#52) ships the mechanism for
the `retired-global-source` tag that #51 introduced and could not set. Exactly
one production row carries it: `global-hasna-deployment-terms`, the owner-ruled
withdrawal of 2026-07-29. The byte-identical `global-agent-rules-standard-N`
rows are deliberately **not** tagged — they are the output of an active
duplicate-minting defect (`43d0c1c0`), and tagging them would mark a live bug's
output as intentional in the one surface built to reveal it.

That family is **not finite and this entry deliberately does not enumerate it**:
read the current membership from the registry rather than from this paragraph.
An adversarial review of the 0.4.18 bump found it had already grown past the
three rows an earlier draft named, five of the additions predating that draft.
A count written here acquires the same shelf life the wrong one had, which is
the argument for the tag being content-driven rather than a slug list — a
synthetic member surfaces as a gap with no code change and no slug
special-casing.

## 0.4.16

Closes **relocation**, the third and last credential-destruction route, which
0.4.15 shipped with and named as still open in its own entry above.

**What was destroying, and why both guards missed it.** `wouldDestroyACredential`
scanned with the config's _declared_ `ConfigFormat`. That union has no `shell`
member, and `detectFormat` returns `text` for any extensionless path — so
`~/.zshrc`, `~/.bashrc` and `~/.npmrc`, the three files most likely to hold a
literal credential, all arrived declared `text`. `text` routes to
`redactGeneric`, which matches token _shapes_ only and never key names, so a
credential with a secret-class KEY and a shapeless VALUE was invisible to the
scan arm on exactly those files. Pair that with a relocation — the placeholder
moved from prose onto the live slot, total count conserved — and the count
backstop does not fire either. Both arms blind, and the write proceeded **at
rc=0 printing `✓ (changed)`**. It destroys on 0.4.14 and 0.4.15 alike; it is not
a regression from #40, which closed the `toml`/`json`/`ini` instances of the same
shape and stopped at the format boundary.

**The fix** resolves the redaction dialect from the TARGET PATH rather than from
the declared format, via `redactFormatForTarget` — promoted from a private
function in `sync.ts` to a shared export so `diff` (the last read before a value
reaches a transcript) and the `apply` guard (the last check before a value is
overwritten) cannot drift apart. It is path-keyed rather than a widening of the
format union, deliberately: `.md` still resolves to `markdown`, so a rules file
documenting a token assignment in prose is not mistaken for a shell config and
frozen from ever shipping an edit. There is a negative control for exactly that,
and **it was vacuous until this release repaired it**: its fixture buried the
assignment mid-prose (`never write NPM_TOKEN=… anywhere`), which `redactShell`
does not match, so both dialects returned nothing and the control passed
whichever one was selected — it stayed green under the exact regression it
names. The fixture now puts the assignment at line start, as the real rules files
do. Verified by mutation: forcing `.md` to resolve to `shell` now fails that test
(9/10), where before the repair it left the suite 10/10.

**Measured in both directions, on the same probe, rather than asserted.** The
relocation suite run unchanged against 0.4.15 fails 3 of 10 with the live value
replaced by the placeholder on `.zshrc`, `.npmrc` and `.bashrc`; against 0.4.16
it passes 10 of 10 with the value intact and the write refused as
`unresolved-secret-placeholder`. Every assertion is on the SURVIVING BYTES on
disk, never on an exit code — the whole defect is that the destroying path exits
0 and reports success, so a status assertion cannot see it.

**What is NOT closed, named rather than left to be discovered.**

- **The dialect map is a fixed list of paths, and that is the axis this fix does
  not vary.** `.zshrc`, `.zprofile`, `.bashrc`, `.bash_profile`, `.profile`,
  `.zshenv`, `*.env` resolve to `shell`; `.npmrc`, `.yarnrc`, `.curlrc`,
  `.netrc` resolve to `ini`. **Any other extensionless credential-bearing file
  still resolves to `text` and is still blind on the scan arm.** The sharpest
  case is **`~/.aws/credentials`**: the `ini` dialect _would_ catch
  `aws_secret_access_key`, so that one is blind only because the path is not
  listed. **`~/.pgpass` is a different and worse shape** — colon-delimited with
  no key at all, so neither `shell` nor `ini` detects it and adding it to the map
  would not rescue it. For both, the count backstop is the only thing standing
  behind the write, exactly as before this release. Measured against the 143 live
  config rows: **zero target any uncovered credential path**, so nothing in the
  current fleet state reaches this residual.
- **A bare `_authToken=` is matched by neither `ini` branch** (the registry branch
  needs the `//host/:` prefix; the generic branch requires the key to start with
  a letter). A separate detector gap, filed rather than widened here.
- **`diff` still redacts only the disk side of a hunk.** A stored row that itself
  holds a literal will print it; that is blocked on the ingest defect and is
  unchanged by this release.

## 0.4.15

Ships the two already-merged fixes that stop `apply` destroying live credentials,
and lifts `PUBLISH_HOLD` under that file's own condition (both named defects
fixed and merged, with the sha, never one of the two).

**Read this before assuming you were safe.** `PUBLISH_HOLD` stated _"Exposure is
currently ZERO: installed and npm-latest are both 0.4.14, which predates the #38
merge."_ That is **false**, measured on station01 and station02 rather than
argued. 0.4.14 carries **no guard at all**, so it destroys on every shape — and
0.4.12 destroys identically. The route is the one #38 was _fixing_, not the one
it introduced: ingest redacts a live value to `{{AUTHORIZATION}}` in the stored
row, and `apply` writes that stored row to disk, exits 0, and prints
`OK (changed)`. Anyone who ran `instructions apply` against a credential-bearing
config on 0.4.12 or 0.4.14 lost that value.

**What is closed, and what is NOT.** The common case is closed: a write that
would put a secret-class placeholder over a live credential is refused, visibly,
via skip owner `unresolved-secret-placeholder`. **Relocation is still open**
(todos `e4d9c22e`): when the target carries the placeholder in one slot and a
live value in another, and the file's declared format is `text` — which
`detectFormat` returns for any extensionless path such as `~/.zshrc`, `~/.bashrc`
or `~/.npmrc` — the count backstop is defeated and the value is still destroyed.
Reproduced by reviewer `tullius` on this candidate. Do not read this release as
"credential destruction is closed".

The guard is targeted rather than blanket, verified with drifted disk content so
a write was genuinely required: ordinary configs, non-secret `{{VAR}}` prose, and
a rules file that _documents_ `{{NPM_TOKEN}}` all still apply.

- fix(apply): refuse to overwrite live config with a secret-class placeholder
  (#40, `06ff066`, todos `e043e6df`). Decides from `scanSecrets` — the same
  detector that creates these placeholders on ingest — rather than from counting
  placeholder occurrences, closing the relocation and `{{NAME:default}}` bypasses
  that defeated a scalar count.
- fix(apply): refuse a write that would destroy live codex/Claude auth (#39,
  `e5462f9`, todos `26caf1b9`, incident 620939 from `numitor`). `profile apply`
  is not a separate code path — it funnels through `applyConfigsWithReport` into
  the same guard, so one guard closes both verbs.

## 0.4.14

Carries one fix, merged to `main` on 2026-08-01 (UTC) as #36, with no release
behind it — so the guard existed in `main` and on no machine. Measured in the
installed 0.4.13 bundle before this release: `findConfigsByTargetPath` appears
**0** times in `dist/mcp/index.js`, against a positive control of 327
occurrences of `config` in the same file, proving the probe read the bundle.

**Operator note — behaviour change on the MCP surface.** `create_config` on a
path some config row already targets now returns an ERROR, where it previously
returned a created config. Any agent or script calling `create_config`
idempotently starts failing on this version; call `update_config` on the owning
row to refresh it in place, or `delete_config` first. This is the same refusal
`instructions add` has enforced since 0.4.13 — but the [BREAKING] notice for
that release described the CLI only, and MCP callers were never covered by it.

- fix(mcp): `create_config` enforces the duplicate-target-path guard the CLI
  added (#36). 0.4.13 made `instructions add` refuse a path the store already
  tracked, because two rows on one `target_path` make `apply` race itself, last
  writer wins, and nothing reports the conflict. The MCP's `create_config`
  handler kept minting twins silently — so the CLI's refusal read as fleet-wide
  protection while the surface agents actually reach through
  (`hasna-configs-mcp.service` runs it) was still unguarded. A guard that covers
  the human path and not the agent path is close to no guard at all, given which
  one writes more rows.

  Routed through `findConfigsByTargetPath`, the CLI's own helper, rather than a
  reimplementation, so both surfaces collapse symlinked ancestors and alternate
  spellings of a path identically — a guard that differs subtly between two
  surfaces is its own defect. Reference configs own no target path and stay
  exempt, matching the CLI. Refusing rather than updating is deliberate and
  matches `add`: the stored row may hold redacted or templatized content that the
  literal bytes on disk would flatten, so overwriting it is the caller's explicit
  choice, not a side effect of `create`.

  The regression test drives the real MCP server over a client transport rather
  than re-implementing the handler — a test that re-implements the handler proves
  only that the test agrees with itself, which is exactly why the existing suite
  could never have caught this. Controlled in both directions: 3 fail / 2 pass
  against the pre-fix bytes, 5 pass / 0 fail against the fix.

## 0.4.13

Cuts two fixes that were both merged to `main` on 2026-07-31 (UTC) and had no
release carrying them, so neither reached a single machine. One patch covers both.

**Operator note — behaviour change.** `instructions add` on a path some config
row already targets now EXITS 1, where it previously exited 0 and silently
created a duplicate row. Any script or loop that re-runs `add` idempotently will
start failing on this version; pass `--update` to refresh the existing row in
place. Announced as [BREAKING] before the release landed.

- fix(configs): one `target_path`, one row; dry-run reports the primary's own
  verdict (#32). Two defects with one root: a config's `target_path` was not
  treated as its identity on disk.

  `instructions add` on a file the store already tracked INSERTED a twin row
  rather than refusing — `uniqueSlug` appended `-1` and both rows survived. Two
  rows on one path make `apply` race itself, last writer wins, and nothing
  reports the conflict. `add` now refuses by default and names the owning rows;
  `--update` refreshes the existing row in place. Refusing rather than silently
  updating is deliberate: the stored row may hold redacted or templateized
  content that the literal bytes on disk would flatten, so overwriting it is the
  operator's call and not a side effect of re-running `add`. Matching is on the
  NORMALIZED path, because the same file is spelled several ways across the store
  — `~/.claude/CLAUDE.md` from `sync`, an absolute path from `add`, or either
  through a symlinked ancestor — and matching the raw string is what let a twin
  in through a different spelling of a path that was already owned.

  Separately, every display line is labelled with a path but read `changed`,
  which ORs in the config's OUTPUTS. A config whose primary file was
  byte-identical while an output had drifted therefore printed the primary as
  "changed" — a dry-run reporting work it was not going to do, which is the
  failure mode that makes a dry-run worth less than not running one. `ApplyResult`
  now carries `primary_changed`, that target's own verdict, alongside the
  deliberately-unchanged `changed` aggregate that profile/sync counters and the
  MCP surface consume. Display surfaces read `primary_changed`; counters keep
  reading `changed`.

- fix(sync): discover project-root `CODEWITH.md`, not just nested (#33).
  `PROJECT_CONFIG_FILES` listed `.codewith/CODEWITH.md` but not `CODEWITH.md` at
  the project root, so a project keeping its instructions in the root file — the
  common layout — synced nothing and reported success. `syncProject` also walked
  `.claude/rules` and `.agents/rules` but never `.cursor/rules`, so Cursor rule
  directories were invisible to project sync; they are now discovered under the
  `cursor-rules` prefix.

## 0.4.12

- fix(diff): stop printing credential values from disk (#30, #31). `instructions
diff` rendered the stored `${VAR}` placeholder against the literal value on
  disk, so the comparison manufactured plaintext that existed in neither side
  alone. Backfilled here — 0.4.12 shipped without a changelog entry.

## 0.4.11

- feat(session-render): accept `@hasna/personas` alongside `@hasna/identities`
  (#27, #29). Backfilled here — 0.4.11 shipped without a changelog entry.

## 0.4.10

Release cutting #20, the fix for `instructions session apply` being unable to write
any managed file on macOS. This is the only change since 0.4.9 and the reason to cut
it immediately is that 14 of the 16 fleet machines are macOS and none of them could
receive a rules render; station03 had been frozen at rules `v1.1.0` since 2026-07-01.

- fix(project-context): stage managed files without the variadic `openat` mode (#20).
  `openat(2)` is variadic — `int openat(int, const char *, int, ...)` — and `mode` is
  the variadic argument the kernel reads only under `O_CREAT`. `bun:ffi` can declare
  only fixed arguments, and a fixed fourth argument happens to match the Linux integer
  calling convention while it does not match arm64 macOS, where variadic arguments are
  passed on the stack. The kernel there read an uninitialised slot: a create asking for
  `0o644` produced `0o140` in one measurement on station03 and `0o000` in another —
  never a mode carrying the owner-read bit — so every readback returned −1 and the
  failure surfaced as `prepared bytes changed before installation`, a hash race that
  never happened. That misleading message is why the defect survived a month.

  Creation no longer travels through the FFI declaration at all; it uses the compiled
  `fs` binding, which builds the variadic call correctly on every platform, and the
  directory anchor is re-established by verifying the created inode through the pinned
  directory fd rather than assumed from the call. The remaining FFI `openat` omits
  `O_CREAT`, so the kernel never reads its variadic slot. One code path on every
  platform, so the Linux suite now exercises what macOS runs.

  Two guards were added so a recurrence cannot present as a phantom race again: an
  unusable staged mode raises `PROJECT_CONTEXT_PREPARED_FILE_MODE_REJECTED`, and a
  staged file that cannot be read back raises `PROJECT_CONTEXT_PREPARED_FILE_UNREADABLE`
  on both the anchored and portable paths.

Note on the CI matrix: the `build` job now runs on `ubuntu-latest` and `macos-latest`.
The reviewer established that the Linux suite cannot catch this defect class —
restoring the broken FFI create leaves Linux at 10 pass / 0 fail — so `macos-latest`
is the sole barrier against recurrence. `main` branch protection was updated in the
same change to require `build (ubuntu-latest)` and `build (macos-latest)`; the previous
single required context `build` no longer matches any job the matrix emits.

The managed-workspace suites were also re-rooted at a symlink-free temp dir, because
`os.tmpdir()` on macOS resolves under `/var/folders/…`, `/var` is a symlink to
`/private/var`, and the renderer's symlink guard rejected it — which is why these
suites had never actually run on a Mac.

## 0.4.9

Release cutting the three PRs landed on `main` since 0.4.8 with no prior version
bump. The reason to cut it now is operational: a standing fleet warning — _never
run `instructions apply` on any `04-hasna-agent-operating-rules-md_` slug\* — exists
because of a defect that #18 fixes, and that warning cannot be retired while the
fix is unpublished.

- fix(apply): extend the session-renderer ownership guard to managed fragments (#18).
  The guard protected four provider entrypoint files by exact-path equality, so
  `<home>/.hasna/instructions/**` — written by the same `instructions-session-renderer`
  writer and `@`-included by the generated entrypoint — was writable by any config row
  that resolved to it. Reproduced on 0.4.8 against the live station01 registry:
  `instructions apply claude-md --dry-run` reports `[owned] … instructions-session-renderer`
  while `instructions apply 01-hasna-global-coding-agent-non-overridable-rules-md --dry-run`
  reports `(changed)`. Same binary, same minute, opposite verdicts — so the fragment path
  really was unguarded, and the check that shows it is not vacuous. Ownership is now derived
  from the renderer's own definitions rather than a second hardcoded list, and intentional
  writes into renderer-owned space need an explicit `--allow-renderer-owned` flag kept
  separate from `--force`.
- fix(session-render): apply the rules currency floor on every render route (#17).
- fix(session-render): stop discarding stored agent operating rules content, and enforce the
  rules currency floor at its own boundary (#16).

Note on the embedded floor: `AGENT_OPERATING_RULES_VERSION` in
`src/lib/global-agent-rules-standard.ts` is still `1.1.6`, pinned to upstream
`hasnaxyz/iapp-identities@48168c54`, while `@hasna/identities` now ships `1.1.16`. That
copy is reachable only via `--config global-agent-rules-standard`, which no live render
invocation passes, so it is inert today — but nothing in either repository's CI compares
the two, and both suites are green while ten versions apart. Tracked separately; not fixed
here.

## 0.4.8

Release cutting the PR-drain landed on `main` since 0.4.7 (three merged PRs, no
prior version bump):

- fix(cli): surface an actionable re-auth message when a cloud API key is revoked (#11).
- feat: add the managed project-context renderer (#12).
- fix: align managed agent rules to v1.1.6 (#14).

## 0.4.7

- Prior published release (2026-07-13); managed dangerous-operation guard standard (#10).
