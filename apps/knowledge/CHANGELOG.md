# Changelog

## 0.3.0

### Minor Changes

- ac63731: Resolve the client credential and the service authority through the shared `@hasna/contracts` client seam (pinned to 1.0.1) instead of this package's own env reads, for the CLI, the MCP server and the `./sdk` export alike. Precedence, re-read on every call: explicit `--api-key`/`--profile`, then the deliberate pointers `HASNA_KNOWLEDGE_API_KEY_OVERRIDE` / `HASNA_PROFILE` / `HASNA_KNOWLEDGE_API_KEY_REF`, then the macOS Keychain item `hasna.credentials.knowledge.api-key` (account `HASNA_STATION`, else `hostname -s`, else `$USER`), then `~/.hasna/knowledge/config/credentials` (0400/0600, `HASNA_HOME`/`HASNA_CONFIG_HOME` aware), then `HASNA_KNOWLEDGE_API_KEY` — a legitimate tier, below disk, with no deprecation notice, so a rotated on-disk key beats a stale shell export. The authority ladder is `HASNA_KNOWLEDGE_API_URL` → the Keychain `api-url` item → the credentials file → `https://api.hasna.com/knowledge`: a key from any tier now reaches the fleet with no URL configured.

  Routing is decided by what resolves, not by a mode switch. `HASNA_KNOWLEDGE_LOCAL` is retired — accepted, ignored and reported as ignored for one release, then deleted — and the `*_MODE` / `*_STORAGE_MODE` ratchet still refuses stale selectors loudly. A configured authority whose credential does not resolve exits non-zero naming every place that was consulted, and never falls back to the on-box store. With nothing configured anywhere the OSS on-box store still applies, and now announces itself once on stderr rather than being a silent state. `knowledge transport` reports the deciding tier and source (a name, a Keychain item reference or a path — never a value).

  `knowledge auth login` still writes `~/.hasna/knowledge/auth.json`, but that file is now a documented LEGACY fallback consulted only when the shared chain finds nothing; move credentials to the Keychain item or the credentials file. `auth status`/`whoami` gained `source_ref` and `tier`, `source` can now report `keychain`, and the default API URL is the fleet gateway rather than `https://knowledge.md`.

### Patch Changes

- 0e98db2: `knowledge auth whoami` (and `auth status`) answer the live question — "can this
  credential read the API right now?" — instead of reporting on env presence.
  The configured snapshot is overlaid with a one-request probe through the read
  transport, so a key that is present in the environment but rejected by the
  server reports `authenticated: false` with the server's reason, HTTP status and
  the failing key's kid. A negative verdict is also a NON-ZERO exit with
  `ok: false`, in `--json` and human output alike, so `knowledge auth whoami` is
  usable as a station health gate: a revoked key no longer passes `set -e`,
  `$?`, or `--json | jq -e .ok`.

  Fixes hasna/apps#1587 (a revoked fleet key passed `whoami` while failing every
  read with 401). The probe landed in #1594 and the exit code in #1761; this
  release is the first one that carries either to npm — @hasna/knowledge 0.2.116
  on the registry still answers a bogus key with
  `{"ok":true,"authenticated":true}`, so stations must upgrade to get the fix.

- da6056f: Switch @hasna/knowledge local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/knowledge` home (with the `HASNA_KNOWLEDGE_HOME` exact-app override) stays the effective home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The resolver covers the global store home, the project-scoped `projects/<key>` sub-root, and the auth store default; the per-app override `HASNA_KNOWLEDGE_AUTH_DIR` is unchanged. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.

## 0.2.116

### Patch Changes

- Resolve @hasna/knowledge local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout, hotfixes plan 0f49f56a task P3.3). The legacy `~/.hasna/knowledge` home stays the effective home until the store is migrated to the XDG data home or `HASNA_DATA_HOME` is set; `HASNA_KNOWLEDGE_HOME` remains the exact-app override. Covers the global store home, the project-scoped `projects/<key>` sub-root, and the auth store default.
## 0.2.115

### Patch Changes

- 09eaf57: Fix `knowledge search` against the hosted API: restore the `/v1/notes/search` client contract (regression from 0.2.114, which called a `/v1/search` endpoint the server never implemented).

## 0.2.114

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.2.113

### Patch Changes

- d02a934: Add `knowledge versions purge --id <id> [--rev <n>] --yes` to permanently scrub retained prior versions that carry credential-shaped values (OPE60-00006). The operation deletes by id/version without ever reading the retained body; the live row is never a purge target.
- 633ebf32a: fix: `knowledge project-panel --project <id|name|slug>` surfaces the project's registered knowledge collection and bound items via the project-links authority instead of the cwd-derived inventory; over the hosted route an unresolvable project ref is now a loud error rather than a silently mislabelled panel.
- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.2.112

### Patch Changes

- 2ea3b9a: fix: packed tarballs no longer carry account-id-shaped 12-digit runs (publish-guard pattern aws-account-id, row 27d2a7a2). The carries were bundled dependency constants — zod's nil-UUID regex (v4/core/regexes.js), pg-types' binary-parser date offset, and the workspace @hasna/contracts bundle — plus one own-source nil-UUID literal in testers. Fixes: externalize zod/pg/@hasna/contracts in the member builds (each remains a declared runtime dependency, so runtime behavior is unchanged), build testers' nil UUID at runtime, and add a per-member publish-guard regression that packs the tarball and scans it with the guard's pattern set (red before, green after).
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.2.111

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.3 (the pinned @hasna/contracts version, per the contracts-pin-drift wave). Todos d175d558.

## 0.2.110

### Patch Changes

- 64a44ef: Byte-reproducibility repair (row c5097108): the committed bin/ and dist/ bundles had been regenerated under a bun other than the pinned 1.3.14, so the verify-generated byte gate failed at every head — bun patch releases emit different bytes for the same source (minifier-assigned identifier names in the minified bundles; the order of the trailing `export { ... }` identifier list and of the `__export` key map in the bundled zod v3 CJS interop in the non-minified dist/ files). Regenerate bin/ and dist/ under the pinned bun 1.3.14; guard the build with `scripts/check-bun-version.mjs` (reads the `bun-version` pin from this app's own ci.yml, refuses to build under any other bun) so a regeneration can no longer silently drift; and make `verify:generated` rebuild twice, requiring the two regenerations to be byte-identical before comparing either against the committed bundles.

## 0.2.109

### Patch Changes

- 745b73d: knowledge-serve --help and --version now answer with exit 0 before any environment-bound work: the serve entry parses self-describing flags ahead of the HASNA_KNOWLEDGE_DATABASE_URL check instead of constructing the DB client first (binds-before-args class).

## 0.2.108

### Patch Changes

- 77bb3e1: Raise the knowledge suite's test budget to the measured safe margin (20000ms per test, the budget the package's own CI defines in apps/knowledge/.github/workflows/ci.yml) in the package test script. The monorepo CI runs the package's `test` script serially on a 4-core runner, where bun's 5000ms default budget is exceeded by spawn-heavy tests under worker contention — measured: `bun test --parallel=4` timed out `public knowledge sdk > exposes a stable client facade for installed apps` at 5195ms (1 fail, exit 1); the same shape with `--timeout 20000` passes 470/2/0 with exit 0. No test is weakened or skipped; the explicit per-test budgets via `tests/support/budget.ts` are unchanged.
- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- 0d7a2d6: fix(knowledge): name the local-SQLite fallback instead of serving it silently. When HASNA_KNOWLEDGE_API_URL is absent, resolveKnowledgeClientTransport now emits one machine-readable JSON notice on stderr per process (`knowledge-local-fallback`) naming the mode switch before serving local — the same family as the merged secrets fix (PR #681 / incident 715558). Incident 715712: a re-provision dropped the hosted pair and items appeared gone at rc=0. URL-without-key keeps failing closed; the notice never fires when the URL selects http.
- 8943403: fix(knowledge): align the hosted search client with the deployed `/v1/search` contract. `knowledge search` against a hosted server now issues the current `GET /v1/search` request (with the current query parameters) and parses the current response envelope, including the deployed rank/result handling; the retired `/v1/notes/search` path is no longer used by the client. Regression coverage in the cloud-store and service-cloud-query suites.

## 0.2.107

### Patch Changes

- 243ce8d: fix(knowledge): regenerate bin/dist bundles — the committed artifacts were stale vs source (canonical project scope + migrate-project-path verb from #362 never rebuilt into the shipped bundles)
- Updated dependencies [b630c48]
  - @hasna/events@0.1.16

## 0.2.106

- Remove the deployment-mode storage vocabulary from the knowledge storage
  surface: mode fields and mode branching are gone from stored contracts and
  storage code, aligning knowledge with the owner directive that there are no
  deployment modes (user-hosted and Hasna SaaS only).

## 0.2.105

- Honor the canonical Knowledge API URL and fail closed with typed errors when
  paged or exact project-resource responses omit or malform their envelopes,
  preventing false `ok: true` results and undefined-resource crashes.

## 0.2.104

- Add package-owned guarded CLI helpers for create, update, bounded query, and
  exact readback. Opaque descriptors cross the child-process boundary only
  through the runtime-owned anonymous process IPC channel; private titles,
  bodies, tags, selectors, and result proofs stay out of argv, stdin,
  environment variables, files, stdout, and stderr. The IPC transport works
  across Bun and Node parents on Linux, macOS, and Windows without Linux
  `/proc` assumptions or a write-before-connection race.
- Reject public/body-bearing guarded CLI input, regular-file descriptors,
  malformed or oversized private frames, replay conflicts, and expired
  descriptors without echoing private content. Preserve FCAME-1 authority
  binding, compare-and-swap/create-if-absent semantics, immutable receipts,
  digest-only proof, exact readback, and same-operation duplicate evidence.

## 0.2.102

- Republish the same reviewed bounded-query product code through the isolated
  exact-clone provenance path so the registry can record the landed commit.

## 0.2.101

- Reject command-shaped unknown lookups before they can fall through to the
  AI-backed prompt path, while preserving the explicit documented prompt forms.
- Prevent unsupported `knowledge show` lookups by stored full ID, short ID, or
  custom item ID from entering prompt or generation paths.
- Add producer-bounded list and ranked-search semantics, private guarded query
  descriptors, mixed-version compatibility, and the live private-query
  acceptance command.

## 0.2.99

- Add bounded exact binding-state readback and receipt-backed guarded adoption
  for legacy Knowledge rows. Adoption requires the full ID, expected version,
  and raw-content SHA-256; changes only the FCAME-1 binding/provenance fields;
  replays deterministically; and can be rolled back only from its immutable
  adoption receipt while the adopted row still matches.
- Preserve ordinary SQLite, hosted PostgreSQL/API, guarded-write, versioning,
  and CLI behavior, including hosted deployments whose `tenant_id` column is
  UUID rather than text.

## 0.2.98

- Ship the hosted guarded-write authority fix from #78: the authority trigger now
  casts hosted tenant IDs to UUID before comparing them, preserving guarded
  write enforcement on hosted Postgres tenants whose signed authority identifier
  reaches the trigger as text.

## 0.2.97

- Fix the FCAME-1 guarded writer so `createKnowledgeGuardedWriter({ env })`
  authenticates guarded HTTP requests with the API endpoint and credential from
  the supplied env, rather than allowing ambient profile, override, or disk
  credential tiers to outrank that caller-supplied transport env.

## 0.2.96

- Align the public declaration surface with the runtime export contract by
  keeping `materializeKnowledgePrivateInput` internal while preserving the
  supported `createKnowledgePrivateInputDescriptor` and guarded-writer API.

## 0.2.95

- Explain recovery from the obsolete `HASNA_KNOWLEDGE_STORAGE_MODE=cloud`
  setting: unset it to preserve the default SQLite backend, or set the mode
  explicitly to `sqlite` or `postgres` when that backend is intended; removed
  placement modes remain invalid.

## 0.2.94

- Add the package-owned FCAME-1 production writer. Private Knowledge payloads
  enter through a metadata-only, in-memory descriptor and travel directly in
  the authenticated HTTP body; the guarded path has no CLI, argv, stdin,
  plaintext-temp-file, local JSON/SQLite, or raw-store fallback.
- Bind every mutation to explicit authority classification/id, signed tenant,
  logical scope, parent, stable operation/step IDs, a deterministic key, and
  create-if-absent or compare-and-swap semantics.
- Add transactional operation claims and immutable terminal receipts, bounded
  exact reconciliation, terminal-completeness assertions, exact full-ID
  readback, and same-operation replay proof/refusal.
- Add immutable ordered workflow manifests with deterministic forward-repair or
  accepted-receipt-scoped compensation keys. Knowledge-authority steps are
  enforced in order, and an exact terminal recovery closes only its accepted
  prefix while leaving accepted completeness false. Cross-authority terminal
  completeness fails closed as
  `external_authority_receipt_verifier_required:<classification>:<authority id>`
  until the external package supplies a verifiable receipt path; this package
  never certifies an Instructions mutation it cannot verify.
- Keep legacy `/v1/notes` and local item-store behavior compatible. Guarded
  routes are additive and remain unavailable until the server has explicit
  `HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION` and
  `HASNA_KNOWLEDGE_AUTHORITY_ID` configuration.

## Unreleased — direct store and conflict-agent test coverage

- Added focused tests for every runtime export in `src/store.ts`, including
  legacy-store collision handling, malformed inputs, atomic persistence,
  lock cleanup/reentrancy, and ID boundaries.
- Added direct tests for `src/conflict-agent.ts` covering complete and limited
  evidence, durable fake-run telemetry, missing provider credentials, and an
  unknown conflict. The source resolver was not duplicated here because its
  successful resolution, revision/citation evidence, ACL denials, and raw-byte
  boundary are already exercised directly in the existing database and
  open-files fixture suites.

## Unreleased — the backend is chosen explicitly, and test egress is refused

**BREAKING for the fleet flip.** `HASNA_KNOWLEDGE_API_URL` +
`HASNA_KNOWLEDGE_API_KEY` no longer select the cloud backend on their own. A flip
that writes only those two variables now leaves the CLI reading the on-box store;
it must also write `HASNA_KNOWLEDGE_STORAGE_MODE=cloud`. Nothing about reaching
the cloud got harder — it has to be asked for.

Why the old behaviour had to go, measured on this machine: both variables were
exported in a login shell, the tmux server carried them, so every pane inherited
them and `bun test` reported **99 failures instead of 1** — 64 of them the same
"cloud API flip is active" refusal, and the rest of the suite operating against
the live store while believing it was isolated. The symptom named neither the
cause nor the store. With this change the same suite, with those variables still
exported and nothing else neutralised, is **309 pass / 2 skip / 1 fail across 312
tests**, the one failure being the pre-existing `context pack and proposal
context commands` case, which is red on `main` too. Before the two redirect tests
below were added it was 307 / 2 / 1 across 310, and the four CI jobs that reached
the test step reported that same 307 / 1 / 310 with none of those variables set —
so the fix makes a polluted local run equivalent to a clean CI run rather than
merely quieter.

- **Request-boundary guard** (`src/net-guard.ts`). While `NODE_ENV=test`, an
  outbound request from this package whose target is not loopback is refused
  before a socket is opened; refusals never name the target host. Verified
  against the real configured endpoint under explicit cloud mode with **0
  connect() syscalls, 0 AF_INET/AF_INET6 sockets and 0 connects to :443**, and
  positive-controlled by the same command with the guard disarmed, which made 4
  connects to :443. This is the primary control, not the environment clearing:
  a preload or `beforeAll` that clears the selector vars is defeated by a later
  file's module-scope assignment, by one `bun test` process sharing one preload,
  and by `bunfig.toml` resolving from the cwd — each of which produced a green
  run with live writes in the sibling `mementos` fix. Loopback is allowed on
  purpose so hermetic transport tests stay real, and that allowance is not a
  springboard: while armed the guard follows redirects itself and checks every
  hop, because `fetch` follows a 3xx internally and an internal hop never returns
  through a `fetchImpl`. A 127.0.0.1 server answering 302 with an off-box
  `Location` reached a public host — measured at 4 connects to :443 and an HTTP
  200 — through a request the guard had already approved; the same probe now
  makes 0 connects and raises the guard's own host-withholding refusal.
- **Explicit mode selection** (`src/knowledge-mode.ts`). The first mode key that
  carries a value wins and returns, so `KNOWLEDGE_MODE=local` is authoritative on
  a machine whose shell exports a URL and a key; with no mode key the answer is
  `local`. Callers hand `@hasna/contracts` a mode-**pinned** environment, in both
  directions, so its own presence-inference
  (`resolveClientTransport`: url + key ⇒ cloud) can no longer pick a backend
  behind this package. Two layers were inferring; both are closed.
- **`knowledge mode`** reports the resolved backend, the env var that selected
  it, pointer vars that are present but ignored, and whether the outbound guard
  is armed. It reads the environment only — no store open, no config read, no
  request — verified byte-identical file trees in an isolated `HOME` and cwd
  across six invocations. Env var **names** only, never values.
- Test isolation, as defence in depth: `tests/cli.test.ts` no longer hands the
  ambient pointer vars to spawned CLI children. `auth whoami` reports
  `authenticated: true` from the mere presence of an API key, so the hosted-auth
  contract test had been measuring the developer's shell instead of the temp auth
  dir it created.

## Unreleased — documentation corrections to the multi-tag work

Wording-only corrections to claims landed by #34/#35. No behaviour change: the
only non-comment source edit is one added `list --help` line, plus one added test
case (six `expect()` calls, 860 -> 866 in `tests/cli.test.ts`); the removal
semantics, exit codes and messages are untouched.

- The `untag` whole-value-versus-split exclusivity is **per raw `-t` value**, not
  "one shape per run". Four sites said per run (`README.md` twice, `src/cli.ts`
  twice); repeated `-t` on `untag` still accumulates, so on an item carrying both
  shapes `untag -t "a,b,c" -t a` removes 2 and `-t "a,b,c" -t a -t b -t c` removes
  4 in a single run. The re-run contract itself is true and unchanged
  (`removed: 1`, then `removed: 3`, then exit 1) — only its stated reason was
  wrong, and the reason is what a reader would reimplement from. (Repeated `-t` on
  `list` narrows instead; that has not changed.)
- Corrected the justification for quoting names in the partial-miss `untag`
  message, at three sites (`README.md`, `src/cli.ts`, `tests/cli.test.ts`). The
  cited case — `(not found: p, q)` colliding with one tag literally named `p, q` —
  is **unreachable**: a comma-bearing value only enters the removal set via the
  whole-value branch, which requires the tag to be stored, so it is found by
  definition and never appears in `not_found`. Because every entry is comma-free
  the `", "` join is injective, so a plain space is a legibility problem, not a
  collision. The load-bearing reachable case is whitespace `trim()` does not
  strip: `-t $'p\nq'` yields `not_found: ["p\nq"]`, which joined raw would break
  the single-line message in two. Now covered by a test assertion.
- Documented an undocumented flag precedence on `list`: when both `--archived` and
  `--include-archived` are passed, `--archived` wins (archived items only) in
  either order. Documented, not changed.
- Made the consequence of a split-only `list -t` conditional instead of universal,
  at three sites (`README.md`, `src/cli.ts`, `tests/cli.test.ts`). All three said
  the defect "returns a DIFFERENT item ... at `total: 1` and exit 0" outright. It
  only does that when the corpus _also_ holds an item carrying the three names
  separately; with the glued item alone it returns `total: 0` at exit 0. Measured
  by removing the whole-value branch from the `list` predicate and running both
  corpora: `total: 0` / no ids with the glued item alone, `total: 1` / the other
  item's id once a split-shape item exists. Both outcomes are silent, so the point
  stands — but which one occurs is a property of the corpus, not of the query, and
  a swap has to be constructed rather than assumed.
- Corrected the `verify:generated` citation under "inventory paths block fix".
  `scripts/verify-generated-artifacts.mjs` only (a) `git diff --exit-code`s
  `bin/knowledge-mcp.js` and `dist`, and (b) greps four generated files for two
  stale Windows-path patterns. It never compares a bundle against its source, so
  its exit 0 says the _untouched_ artifacts are untouched — measured: it exits 0
  with `src/cli.ts` diverged from `bin/knowledge.js`, and exits 0 even with
  `bin/knowledge.js` corrupted outright. To check bundle/source sync, rebuild the
  bundle to a temp outfile with the `build` script's command and compare against
  the committed file after per-line trailing-whitespace stripping (see
  `scripts/strip-generated-trailing-whitespace.mjs`), and read the lockfile caveat
  below first.

Two pre-existing problems were found while verifying this and are **not** fixed
here, because both need their own change and review:

- **`bun run verify:generated` is red on `main`**, independently of this entry.
  The script rebuilds first, and the rebuild does not reproduce the committed
  `bin/knowledge-mcp.js` or `dist/index.js`: `package.json` is inlined into the
  bundles and gained a `files` entry in #33 that the committed mcp bundle predates,
  and the zod codegen in `dist/index.js` has drifted. `bin/knowledge.js` is not
  affected (it is `--minify`ed). Only `bun scripts/verify-generated-artifacts.mjs`
  on its own exits 0.
- **There is no committed lockfile**, so `bun install --frozen-lockfile` exits 0
  while pinning nothing. `@hasna/events` is bundled into `bin/knowledge.js` (it is
  not in the `--external` list) and is declared `^0.1.3`, so the rebuild-and-compare
  check below is dependency-state-dependent: 0.1.14 reproduces the committed bundle,
  0.1.13 does not. Check `node_modules/@hasna/events/package.json` before concluding
  a bundle is out of sync.

## 0.2.92

Release-only bump. No source change: this ships work already merged to `main`
that no published artifact carried.

The headline is the `-t/--tag` silent data-loss fix from **#34**
(`fix(cli): stop silently dropping repeated -t tags on add/update/upsert`,
merged 2026-07-27T19:39:04Z). That fix landed three days _after_ 0.2.91 was
published (2026-07-24T15:52:10Z) and `package.json` was never bumped, so `main`
and the registry both reported `0.2.91` while behaving differently — `main`
stored all five tags, the published artifact stored only the last one — and
`npm publish` could not ship the fix at all, because that version already
existed. Measured against installed 0.2.91:
`knowledge add … -t convention -t naming -t repos -t github -t proposed`
stored `["proposed"]` at exit 0. Because tags are the retrieval surface, such an
entry is invisible to every `--tag` query, which is indistinguishable from never
having been written.

Since the version number was identical, nothing signalled the difference. The
same gap held back **31 other commits** merged since the 0.2.91 publish,
including the request-boundary guard, the platform-agnostic redaction fix, the
`ok_untag` truthful-removal fix and the generated-artifact checks described under
"Unreleased" above; they ship here too.

- Bump `0.2.91` → `0.2.92` and regenerate the shipped bundles, which embed the
  version string. The bundle diff is provably the version string alone:
  `bin/knowledge.js` and `bin/knowledge-mcp.js` are byte-identical to their
  predecessors once `0.2.92` is reverted to `0.2.91`, and
  `verify:generated` reports all 6 bundles rebuilding byte-identically.

## 0.2.91

Harden the local JSON item-store against lock corruption and add a sanctioned
recovery path for merging a legacy app-folder workspace into a populated
canonical workspace. Composes with the safe legacy global-store import (0.2.90):
`withLock` remains reentrant and the hardened lock replaces the previous
check-then-write acquisition used by that import.

- Replace the check-then-write JSON store lock with exclusive `open(..., 'wx')`
  creation, owner metadata (owner-only release), PID-aware conservative
  stale-lock quarantine (stale locks are renamed aside, not blindly deleted,
  behind a dedicated breaker lock), non-busy `Atomics.wait` retry sleep, and
  fsynced temp-file writes with atomic rename (`writeFileAtomic`).
- Add `knowledge storage merge-legacy-path` (CLI + service + SDK): dry-run by
  default with current/legacy/duplicate/stranded/conflict/expected/final item
  counts, refuses conflicting duplicate IDs or `short_id` collisions, snapshots
  the legacy workspace before writing, merges only non-conflicting legacy items
  under a lock, and is idempotent on rerun.
- Avoid opening SQLite (WAL locks) while summarizing a workspace that is about to
  be moved during `migrate-legacy-path`.

## 0.2.90

Knowledge private-ref lint/redaction hardening (rescoped from PR #18, originally
authored against the pre-reconcile 0.2.78 line). The parts of the original change
that re-introduced the client-side Postgres sync engine and legacy local-JSON
item writes were dropped, since `main` already removed those forbidden
DSN-on-client paths and unified item CRUD behind the Store abstraction. Kept only
the additive, non-regressive security hardening:

- Add `src/private-ref.ts`: lint (`assertNoPrivateRefs`) and redaction
  (`redactPrivateRefs`) for private `.hasna` paths, `file://` URIs, raw
  DB/export refs, `cloud.env`, and database URLs.
- Apply private-ref lint on source/manifest/app-wiki ingestion and redaction on
  sync-bundle export/import (including embedded artifact bytes).
- Block forbidden Knowledge workspace artifacts (`cloud.env`, pre-cloud DB/JSON
  backups, `migration-exports/`) in `storage validate`; make `storage validate`
  exit non-zero on failure. Gate sync export/import on a valid storage contract.
- Document runtime-env/secret-ref handling in the storage contract
  (`secret_handling`) and record DB URL rotation as blocked without live secret
  authority. No live secret mutation performed.
- Make local stores, workspaces, artifacts, backups, and exports owner-only
  (0700 dirs / 0600 files) where Knowledge writes them.
- Bump the MCP stdio test timeout to 10s to reduce flakiness on slower hosts.

## Unreleased — inventory paths block fix

Fix `knowledge inventory --json` reporting the wrong `paths` block in
self_hosted/cloud (api) mode, where it disagreed with `knowledge paths`.

- fix(knowledge): the `inventory` `paths` block now reflects the real on-box
  workspace layout (`json_store_path` = `workspace.jsonStorePath`,
  `json_store_exists` / `knowledge_db_exists` via read-only `existsSync`),
  matching `knowledge paths`. Previously `itemOnlyInventory()` echoed the cloud
  transport URL as `json_store_path` and hardcoded `knowledge_db_exists: false`.
  The cloud item-corpus source location is still surfaced via `legacy_store.path`.
- test(knowledge): `tests/cloud-inventory.test.ts` now asserts `inventory.paths`
  equals `service.paths()` for all four path fields, that the `/v1` URL never
  appears in the paths block, and that it is reported on `legacy_store.path`.
- Rebuilt generated bundles so shipped artifacts carry the fix. `verify:generated`
  passing is **not** evidence that a rebuilt bundle matches its source — see
  "documentation corrections to the multi-tag work" for what that check does and
  does not prove, and for the check that establishes bundle/source sync.

## Unreleased — Search overhaul, Stage 2 (Postgres full-text parity)

Top-priority correctness fix: the hosted (cloud) notes list returned materially
different, near-empty results versus local. Brings cloud search to parity with
the local SQLite FTS behavior shipped in Stage 1 (#29).

- Replaced the `title/content ILIKE '%q%'` + `ORDER BY created_at DESC` cloud
  path (`NoteRepo.list`, `src/serve.ts`) with a weighted `tsvector` generated
  column (title = A, content = B) + GIN index (`src/db/pg-migrations.ts`),
  queried via `websearch_to_tsquery('english', …)` and ranked by `ts_rank_cd`
  (created_at as a deterministic tiebreak). Fixes the "cloud returns nothing"
  bug where multi-term / word-order-varying queries matched no substring and
  results were ordered by recency rather than relevance.
- Postgres migrations are **appended** to `PG_MIGRATIONS` (index-derived ids,
  never inserted mid-array) and are idempotent.
- Added an in-process Postgres (`@electric-sql/pglite`, devDependency) parity
  suite (`tests/search-pg-parity.test.ts`) running the real `NoteRepo` against
  the real migrations, asserting word-order independence, relevance-over-recency,
  phrase adjacency, `total` reflecting the FTS predicate, and sqlite-vs-pg
  equivalence over the shared corpus.

## 0.2.90

Fix the unsafe legacy global-store migration. `ensureStore` previously copied
`~/.open-knowledge/db.json` verbatim over the canonical `~/.hasna/knowledge/db.json`
on first global use, which could clobber an existing canonical store.

- Replace the raw first-use copy with a safe merge: canonical records win on `id`/`short_id`
  collisions, the legacy file is treated as a read-only source (never moved/rewritten/deleted),
  invalid records are counted and skipped.
- Add `knowledge storage import-legacy [--dry-run] [--scope global] [--json]` for explicit
  preview/import with import reports (under `runs/`) and pre-import backups (under `exports/`)
  when an existing canonical store changes. The command is global-only and rejects other scopes.
- Make `withLock` reentrant within a single process so an import invoked while the caller
  already holds the canonical store lock does not self-deadlock.
- Add focused CLI tests: dry-run preview, project-scope rejection, existing-canonical merge/
  no-overwrite/idempotent re-run, and reentrant-lock import.

## 0.2.89

Harden public npm package contents so internal docs never ship. The published
package previously included the entire `docs/` and `scripts/` trees via broad
`files` entries, which packed `docs/canonical-secrets-bootstrap-2026-06-08.md`
(internal secret-path topology and account references) into the public tarball.

- Replace the broad `docs` and `scripts` entries in `package.json` `files` with an
  explicit allowlist of public guides and dev scripts; the internal
  secrets-bootstrap runbook is now excluded from the package.
- Add `scripts/validate-public-package.mjs` (`npm run release:pack:check`), a
  fail-closed check that diffs `npm pack --dry-run` against the allowlist and
  rejects any unreviewed or forbidden docs/scripts path. Wired into
  `prepublishOnly`.
- Add `tests/package-release.test.ts` (`bun run test:package`) asserting the
  allowlist and the packed manifest.
- Document the allowlist policy in `README.md` and `SECURITY.md`.

## 0.2.88

Security/hygiene: stop shipping the internal infra host `knowledge.hasna.xyz` as the
default hosted API URL in the published package. The default now resolves to the public
product domain `https://knowledge.md`.

- `DEFAULT_KNOWLEDGE_API_URL` (`src/auth.ts`), `defaultKnowledgeConfig()` hosted default
  (`src/workspace.ts`), the `normalizeMode` alias (`src/service.ts`), and doc comments in
  `src/cli.ts` / `src/cloud-store.ts` now use `knowledge.md` instead of the internal host.
- Propagated to README, `docs/examples`, `docs/migration`, and `tests/cloud-store.test.ts`.
- Rebuilt `dist/` and `bin/` (shipped artifacts) so the leaked default is gone from what
  installs actually run, not just source.
- Known residual (out of scope, needs a `@hasna/contracts` fix): when hosted mode is set
  with a key but no URL, `defaultCloudBaseUrl()` in `@hasna/contracts` still templates
  `https://<app>.hasna.xyz`. `createClientTransport` exposes no base-URL override, so this
  repo cannot close that path alone. Documented explicitly in `tests/cloud-store.test.ts`.

## 0.2.87

Reconcile `main` with the published npm line (`npm/knowledge/v0.2.86`), which had
diverged: the deployed runtime carried a Store-unification + cloud-routing refactor
that never landed on `main`, while `main` carried two CLI fixes the published line
lacked. This release re-converges both histories.

- Merge the published release tag `npm/knowledge/v0.2.86` into `main` (merge commit,
  preserving full ancestry so future `merge-base --is-ancestor` checks pass). Brings in:
  - refactor(store): unify knowledge-item CRUD behind one Store (LocalStore + ApiStore) (1506111)
  - refactor(knowledge): remove dead raw-fetch RemoteKnowledgeClient, make registry descriptor truthful (2b6bd21)
  - fix(knowledge): close residual cloud-mode routing gaps for catalog commands (2d235a9)
  - fix(knowledge): route SDK item CRUD + inventory through the unified Store in all 3 modes (92c3fcc)
  - fix(knowledge): close split-brain read + drop dead API client and client DSN surface (5213a51)
  - fix(knowledge): stop context-pack hang, repair cloud project-panel, drop dead remote command (8daa0ea)
- Retains the two `main`-only CLI fixes on top of the refactor:
  - fix(cli): don't leak internal Error stack on usage/validation errors (#23)
  - fix(cli): make `<sub> --help` print per-command usage (#24)
- Version bumped to 0.2.87 (strictly above published 0.2.86) so npm and `main` reconverge on publish.
