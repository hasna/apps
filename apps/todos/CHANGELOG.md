# Changelog

## 0.15.51

### Patch Changes

- Switch @hasna/todos local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/todos` default stays the effective data home until the store has actually been migrated to the XDG data home (`todos.db` or `config.json` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME`. The global database, config, training, replays, sandbox profiles, cloud-task-id cache, and the install-time postinstall provisioning all resolve through the same effective root. The dependency is pinned exactly to `@hasna/paths@0.1.0`.

## 0.15.50

### Patch Changes

- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.1

## 0.15.49

### Patch Changes

- 11ba577f: Bounded dedup projection (O15-00170): dedup workflows now capture only the fields the dedupe fingerprint consumes instead of credential-bearing whole-task composites (incidents 713001/713022/713043-46/713119), surfaced through the new `todos dedupe project --json` command; the shared redactor also gains the xai-token pattern on every surface.
- af5e91ef: Sync push's destination preflight now throws a typed `ResourceConflictError` (`SNAPSHOT_DESTINATION_CONFLICT`) so the mirror/outbox parks persistent destination collisions instead of retrying them as transient (duplicate-key retry storm).
- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.15.48

### Patch Changes

- 9fd8163: Sync push classifies scoped-slug unique violations as typed conflicts (ba6e4a19). pushSnapshot's ON CONFLICT arbiter is the table PRIMARY KEY, but the deployed uniqueness invariants are the partial expression indexes todos_sync_records_task_list_scope_slug_uidx and todos_sync_records_project_task_list_slug_uidx, so a slug collision on a different object_id bypassed the upsert and raised a raw 23505 that the mirror (5x) and durable outbox (8x) retried as transient — the duplicate-key retry storm under load. pushSnapshot now maps 23505 to ResourceConflictError codes TASK_LIST_SLUG_CONFLICT / PROJECT_SLUG_CONFLICT (with a metadata-less fallback re-read, mirroring the adapter's renameProjectAtomic), runs the destination-conflict read plus inserts in the client's transaction when available, and the mirror/outbox retry machinery parks typed conflicts immediately instead of re-enqueueing them.

- b8ba49f: `GET /v1/tasks` and legacy `GET /api/tasks` validate the pagination bounds (O15-00354). Malformed values — `limit` 0, negative, or non-numeric, and a negative/non-numeric `offset` — now return HTTP 400 instead of silently answering 200 with the entire table (`0` and `NaN` are falsy, so the store's `if (filter.limit)` dropped the LIMIT clause and SQLite `LIMIT -1` means "no limit"). Regression tests cover each malformed bound plus a valid-pagination control.

- f8338ff: ensureCloudSchema retries are throttled with a min-interval cooldown (O15-00479 follow-up to PR #931). Sustained schema failure re-ran the idempotent DDL sequence on every /v1 request, saturating the connection pool under lock contention. Calls inside the min-interval window (default 10s, `HASNA_TODOS_SCHEMA_RETRY_MIN_MS`) rethrow the recorded failure without re-running the DDL; the memo stays cleared so the first call after the interval retries.

- cd86caf: Sync push's destination preflight now throws a typed `ResourceConflictError` (`SNAPSHOT_DESTINATION_CONFLICT`) instead of a generic `Error`. The preflight (an existing task-list slug or project task_list_id on a different object_id) previously entered the mirror/outbox retry queues as a generic error, so a persistent destination collision kept retrying — feeding the same duplicate-key retry storm the 23505 classifier removes. The typed error is parked immediately by the retry machinery, matching the 23505 path.

## 0.15.47

### Patch Changes

- 507e701: Retry transient Postgres lock failures on the guarded task-write path instead of surfacing HTTP 500 (fixes incident 724667 / HP-00083): on 2026-08-22 the hosted authority returned HTTP 500 for PATCH /tasks/{id} in bursts (measured 83 failures at 17:50-17:59Z and 83+ at 19:30-19:32Z), each surfacing `PostgresError: canceling statement due to lock timeout` (SQLSTATE 55P03) — the `todos_app` role's 5s `lock_timeout` canceled the task-parent-integrity advisory-lock statement or the guarded write while another transaction held the lock. The condition is transient (recovery within seconds), and the /v1 route mapped the unhandled error to HTTP 500, indistinguishable from a crash. The postgres storage adapter now retries the whole guarded write transaction (advisory lock + version-CAS statement) on transient Postgres errors (55P03 lock timeout, 40P01 deadlock, 40001 serialization) with a bounded backoff, and the idempotent schema DDL retries in-request; the version CAS is re-evaluated per attempt so optimistic concurrency is preserved. Regression tests: postgres-lock-retry.test.ts (retry on 55P03, bounded attempts, no retry on non-transient errors, CAS preserved across retries), plus updated schema-sync retry tests.

## 0.15.46

### Patch Changes

- 4794bda: Release-review P1 remediation (0.15.44 review, findings 1-2): the Postgres sync adapter's changed-since path (`getChangedSince` / `getTasksChangedSince`) and the cloud changed-since/report path (`cloudChangedSince`) compared `updated_at` against the cursor as raw text. Stored stamps mix ISO ("2026-08-05T18:54:55.814Z") with space-form ("2026-06-10 11:24:47", the DDL default `datetime('now')` plus snapshot import/sync), and as text space (0x20) sorts before 'T' (0x54), so space-form rows that are genuinely NEWER than an ISO cursor were silently omitted from changed-since feeds, CLI summaries, and activity reports. Both paths now compare the stamps as instants via a shared `changedSinceStampNewer` helper (apps/todos/src/lib/instant-compare.ts) mirroring the SQL `julianday()` predicate used by the SQLite/Postgres updated_after paths, including its keep-unparseable semantics: a stamp that cannot be parsed is KEPT, because "cannot read the row's timestamp" is not "older than the cursor"; naive (no-offset) stamps are read as UTC, matching SQLite julianday. Regression tests: postgres-adapter changed-since space-form case (storage.test.ts), cloud changed-since space-form/unparseable case (cloud-router.test.ts), helper unit tests (instant-compare.test.ts).

## 0.15.45

### Patch Changes

- b8f1f5d: task-subtree-transfer postgres backend: `ensureSchema()` no longer caches a rejected one-time schema sync. The `schemaReady ??=` memo (apps/todos/src/task-subtree-transfer/postgres.ts) previously kept the rejected promise forever, so a single transient Postgres lock timeout (SQLSTATE 55P03) during the boot-time schema statements was replayed on every later transfer operation instantly — with no DB round trip — permanently bricking the subtree-transfer authority (wired into the same process as the storage adapter via the cached singleton in server/cloud.ts). A failed sync is now cleared and retried on the next operation with fresh state, matching the pattern landed for the storage adapter (PR #931) and pr-groups / project-registration (PR #933). Regression test: a failed schema sync is retried on the next operation instead of being cached forever (task-subtree-transfer-schema-retry.test.ts).

## 0.15.44

### Patch Changes

- 73f839e: ensureSchema() no longer caches a rejected one-time schema sync (fixes incident 724661): the boot-time schema statements previously ran into a cached `schemaReady` promise that was never cleared on failure, so a single transient Postgres lock timeout (e.g. `canceling statement due to lock timeout`, SQLSTATE 55P03, under the `todos_app` role's 5s `lock_timeout`) was replayed on every later operation instantly — with no DB round trip — permanently bricking the store until the task was replaced. A failed sync is now cleared and retried on the next operation with fresh state. Applies to the postgres storage adapter (task write path) and the pr-groups, task-manifest, and project-registration postgres backends. Regression tests: a failed schema sync is retried on the next operation (postgres-adapter, pr-groups ledger).

## 0.15.43

### Patch Changes

- 1c859c2: getTasksChangedSince compares the since-cursor via julianday() instead of raw TEXT (fixes row 23ce88cb): stored stamps mix ISO "2026-08-05T18:54:55.814Z" with space-format "2026-06-10 11:24:47" (the DDL default datetime('now'), plus snapshot import/sync), and as text "T" sorts after " ", so the old `updated_at > ?` comparison silently excluded space-format rows that are genuinely newer than the cursor from changed-since feeds (MCP get_tasks_changed_since, sync adapter, HTTP changed-since and report routes). Mirrors the sibling updated_after predicate in task-crud.ts, including its keep-unparseable semantics: a stamp julianday() cannot parse yields NULL and the row is KEPT, because "cannot read the row's timestamp" is not "older than the cursor".

## 0.15.42

### Patch Changes

- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.15.41

### Patch Changes

- e6134c1: Fix the 0.15.38 /v1 503 (row ae34a051, incident 720366): wire `keyStatus: store.keyStatus` instead of the deprecated `isRevoked`-only hook, which @hasna/contracts >= 0.8.7 refuses at verifier construction — the #761 lockfile regeneration moved todos from the stale-locked contracts 0.5.2 to 0.13.1, so every /v1 business route returned HTTP 503 with a valid key while /health and /version stayed 200. Regression tests: `src/server/cloud-auth-wiring.test.ts` (default lane) and `src/server/cloud-auth-wiring.pg.test.ts` (TODOS_TEST_PG_URL lane).
- 2e3ab38: Fail closed on unsupported or empty project filters (I38-00523): `todos projects --project <ref>`, `todos show --project <ref> <id>`, and `todos list --project-name ""` / `--project ""` previously returned success at rc=0 with unfiltered or full-population output and empty stderr; each now fails closed with a usage error. 7 regression tests (4 negative + 3 positive controls) against a stub /v1 authority.
- 65647c2: Make `deliverTodosApiKeyViaDisk` refuse the real machine home (todos 1c86abeb): when `HOME` resolves to this machine's real home directory, delivering a fixture credential now throws `TODOS_FIXTURE_HOME_IS_MACHINE_HOME` instead of replacing the machine's configured todos credential with the fixture value; test fixtures must pass a throwaway home.
- Release path: fix the root build entry layout and the pack lifecycle. The root multi-entry `bun build` command gains `--root src`, restoring `dist/index.js`, `dist/mcp.js`, `dist/registry.js`, `dist/contracts.js`, `dist/storage.js`, `dist/testing.js`, `dist/project-registration.js`, `dist/task-manifest.js`, and `dist/task-subtree-transfer.js` at the `dist` root (with 9 entries bun auto-derived the project root instead of the entries' common `src/` directory and emitted them under `dist/src/`, leaving `package.json` `main`/`exports` pointing at files the tarball did not contain). The `prepack: bun run build` hook is removed: the package-owned release gate (`verify-public-release.ts`) builds from the clean source commit and packs with `--ignore-scripts`, and a prepack rebuild would make the `npm publish` tarball differ from the verified pack (the gate forbids lifecycle pack scripts).

## 0.15.40

### Patch Changes

- @hasna/contracts@0.13.3

## 0.15.39

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.15.38

### Patch Changes

- @hasna/contracts@0.13.1

## 0.15.37

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- 0d7a2d6: fix(todos): name the local-SQLite fallback instead of serving it silently. When neither HASNA_TODOS_API_URL nor HASNA_TODOS_API_KEY is set, resolveTodosCliTransport now emits one machine-readable JSON notice on stderr per process (`todos-local-fallback`) naming the mode switch before serving local — the same family as the merged secrets fix (PR #681 / incident 715558). Incident 715712: a re-provision dropped the hosted pair and tasks appeared gone at rc=0. Partial pairs keep failing closed; the notice never fires when the hosted pair selects http.
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.15.36

### Patch Changes

- 058cb86: Fix `todos comment <plan-id>` returning 404 "task not found": plans now have a comment surface end to end — `plan_comments` table (local sqlite) and `plan_comments` records (postgres), `/v1/plans/:id/comments` GET/POST, CLI `comment` task-first/plan-fallback (local + hosted), and `plans --show` listing plan comments. Plan-level outcomes can now be recorded on the plan row (todos task 04ee08fd).
- 3fa7d73: Remove the deprecated storage-mode env selection (owner deprecation, 2026-07-29 deployment-modes removal). The client now routes on `HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY` alone; any storage-mode var now hard-errors instead of silently selecting a backend. Breaking/behavioral change: configurations still setting the deprecated var must drop it before upgrading to 0.15.34.
- 4c8ab45: Bound every authenticated /v1 request to a single 10s budget in the CLI's cloud router (task 9b050845). `todos count` on a stalled /tasks endpoint previously hung past 120s and then reported REMOTE_API_UNREACHABLE while the authority was reachable; the contracts transport's 30s timer was consumed by two retries of a timeout-shaped failure, an abort-ignoring fetch hung unbounded, and `response.text()` after headers was unbounded. A stalled request now fails within the bound with REMOTE_API_TIMEOUT (slow authority), non-retryable, instead of the multi-minute hang followed by REMOTE_API_UNREACHABLE (down authority).
- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.15.35] - 2026-08-17

### Fixed

- **Bounded remote request timeout.** `todos count` and every other
  authenticated `/v1` command against a stalled authority now fail within a
  single 10s request bound and report `REMOTE_API_TIMEOUT` — "the authority is
  slow" — instead of hanging for minutes and then reporting
  `REMOTE_API_UNREACHABLE` — "the authority is down". Timeout-shaped failures
  are no longer retried into a multi-attempt hang. (task 9b050845)

- **`list --limit N` no longer caps silently.** A bounded read was
  indistinguishable from the full population: `--limit 2000` returned exactly
  2000 rows of a 7,839-row pending set at rc=0 with no truncation signal. The
  forwarded path now requests limit+1 as a truncation probe and slices to the
  caller's limit; the withheld path (--sort, --overdue/--due-today, creator
  and task-list filters, scalar-status union) compares the pre-window set. A
  truncation is reported on stderr — the same channel as the scan-ceiling
  warning — while `--json` stdout stays a clean parseable array. Applies to
  the HTTP authority and the local SQLite store. (todos 52b0a207)

## [0.15.34] - 2026-08-15

### Changed

- **The deprecated storage-mode env selection is removed.** The client now
  routes on `HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY` alone; any
  storage-mode var now hard-errors instead of silently selecting a backend.
  Configurations still setting the deprecated var must drop it before
  upgrading.

## [0.15.33] - 2026-08-14

### Fixed

- **Historical project-registration receipts can be looked up by their
  immutable stored corpus identity while current create and inverse authority
  guards remain bound to the current capability.**

## [0.15.32] - 2026-08-12

### Fixed

- **Task-manifest apply and compensation now bind operation steps, deterministic
  idempotency, terminal nonacceptance receipts, and exact legacy slug
  compatibility across SQLite, PostgreSQL, HTTP, CLI, and OpenAPI surfaces.**

## [0.15.31] - 2026-08-12

### Fixed

- **The npm release full suite keeps single-pass failure semantics while
  allowing finite GitHub-runner scheduling headroom.** The root release gate
  now uses a 30-second per-test and hook ceiling instead of Bun's inherited
  five-second default, while continuing to forbid retries so deterministic
  assertion failures and genuine hangs still stop publication.

## [0.15.30] - 2026-08-12

### Added

- **The Todos project-resource producer exposes stable, complete project and
  task-list bindings.** `project-registration project-resources` now enumerates
  deterministic resources for a canonical source project across SQLite,
  PostgreSQL, authenticated HTTP, OpenAPI, and the generated SDK, with bounded
  paging, mutation restarts, duplicate and cursor guards, and exact UUID
  readback.
- **Prior Projects registration adoption is explicitly verifiable.**
  `validatePriorRegistrationAdoption` and the matching CLI, HTTP, OpenAPI, and
  generated-SDK surfaces validate the stored authority, target identity, and
  receipt digest before a caller adopts an existing project or task list.

### Fixed

- **Historical pre-adoption receipts remain compatible without weakening
  integrity.** Bind-existing digests are anchored to the immutable resource
  incarnation, PostgreSQL serializes adoption against concurrent renames, and
  hosted validation rejects false, malformed, or forged response envelopes.
- **npm release review receipts stay out of GitHub Actions step preambles.**
  Both receipt-consuming steps now source the capability-bearing receipt from
  the `npm-release` environment secret surface while preserving the existing
  exact package, version, tag, commit, workflow, reviewer, and signature gates.
- **The next optional AI companion candidate is `@hasna/todos-ai@0.1.2`.** The
  unpublished candidate carries the masked receipt-delivery regression needed
  for the real negative/positive release-workflow verification.

## [0.15.29] - 2026-08-11

### Fixed

- **Historical project-registration receipts remain addressable after package upgrades.**
  Exact source identity now includes the stored authority route and package
  version across SQLite, PostgreSQL, authenticated HTTP, and the
  `project-registration receipt-lookup` CLI without weakening current-version
  checks on create or inverse operations.

## [0.15.28] - 2026-08-11

### Fixed

- **Todos AI preserves host-created clarification and approval control signals
  across the bundled companion boundary.** This includes zero-trap containment
  for outer and nested `Proxy` payloads.

## [0.15.27] - 2026-08-11

### Fixed

- **Hosted task-manifest lookup derives the authenticated authority tenant.**
  The package-owned OpenAPI now advertises the tenant-bearing capability route,
  the generated SDK exposes that contract, and the built CLI verifies both
  omitted capability-derived and explicit tenant lookup without local fallback.
- **Hosted task creation advertises explicit creator compatibility.** The same
  generated server contract continues to expose `created_by` on both
  `CreateTaskInput` and `Task`, so compatible clients can prove the field before
  mutation and verify it on authoritative readback.

## [0.15.26] - 2026-08-10

### Fixed

- **Task-manifest CLI execution is supported across local, SQLite, and
  PostgreSQL authorities.** The CLI now preserves deterministic plan slugs
  across backends and the test fixtures share one bounded projection for the
  unrelated external Bun ancestor-package warning.

## [0.15.25] - 2026-08-10

### Fixed

- **Default Todos AI sessions retain their safe task read tool.** An
  unconfigured workspace now keeps the minimal profile's bounded `get_task`
  tool while list and mutation tools remain subject to explicit workspace
  trust.

## [0.15.24] - 2026-08-10

### Fixed

- **Release CI installs the independently locked AI companion before recursive
  tests.** The npm workflow now installs `ai/bun.lock` dependencies before the
  root `bun test`, retaining the Todos AI content from the unpublished
  `0.15.23` release while advancing the package to `0.15.24`.

## [0.15.23] - 2026-08-10

### Added

- **Todos gains an optional provider-neutral AI companion.** `@hasna/todos-ai`
  adds the `todos ai` CLI contract, a Groq adapter, typed and streaming output,
  bounded read/write tools with guarded mutations, and deterministic evaluation
  and redaction without placing provider dependencies in the root package.

### Changed

- **CI validates the independently locked AI companion.** Pull requests install
  `ai/bun.lock` with Bun 1.3.14 and run its typecheck, full test suite, and build
  in addition to the existing root and dashboard gates.

## [0.15.22] - 2026-08-10

### Fixed

- **Remote stale-lock recovery follows the deployed authority contract.** The
  CLI advertises and invokes `stale-lock-handoff` only when the authority's
  OpenAPI document exposes the exact route, sends no mutation to older
  authorities, and permits a new authenticated session with the same agent name
  to refresh an exact stale lock through holder/version CAS plus an audit
  receipt ([#258](https://github.com/hasna/todos/pull/258)).
- **PostgreSQL stale-lock recovery no longer depends on a schema helper.** The
  exact stored `locked_at` token is compared as text before PostgreSQL casts only
  the already-validated, PostgreSQL-compatible request token for the stale
  cutoff, so missing helper functions, ISO year zero, and malformed stored
  timestamps fail closed without mutation
  ([#261](https://github.com/hasna/todos/pull/261)).

## [0.15.20] - 2026-08-09

### Added

- **npm publishing requires an Ed25519-signed independent-agent `GO`.** The
  package-owned workflow and prepublish gates reject missing, unsigned,
  `NO_GO`, mismatched, tampered, wrong-key, self-review, and replayed receipts
  unless they bind the exact repository, commit, package version, tag,
  workflow revision, registry, reviewer, and publisher.

### Fixed

- **Exact stale task locks can be handed off atomically.** `todos
stale-lock-handoff <id>` fences on the expected holder and lock version,
  rejects live or mismatched locks, transfers only the named task across local
  and authenticated `/v1` authorities, and returns an immutable audit receipt.

## [0.15.19] - 2026-08-09

### Fixed

- **Hosted plan completion stays on the authenticated authority path.** When
  the direct completed-status route is unavailable, the CLI uses the supported
  revision-guarded completion operation and verifies authoritative readback
  without broad snapshot replacement ([#243](https://github.com/hasna/todos/pull/243)).
- **Remote task retry requires an advertised capability.** The CLI checks the
  authority's boolean retry capability before mutation and fails closed for
  missing or incompatible remote schemas while preserving the local retry path.
- **Comments accept explicit file input.** Comment creation can read the body
  from a requested file while preserving inline input and authenticated cloud
  creator attribution ([#242](https://github.com/hasna/todos/pull/242)).

## [0.15.18] - 2026-08-09

### Fixed

- **Hosted exact-list reads reuse the resolved list's project scope.** UUID and
  slug reads now bound legacy compatibility scans by the owning project, apply
  output limits after exact local filtering, and reject conflicting explicit
  project/list scopes before reading tasks.

## [0.15.17] - 2026-08-09

### Fixed

- **Task failure now routes through the selected authority.** `todos fail
--reason [--retry]` uses the supported local or authenticated `/v1` lifecycle
  path, preserves failure reasons in readback, exposes the operation through
  OpenAPI and the generated SDK, and rejects unsupported lifecycle status
  values at the server boundary ([#237](https://github.com/hasna/todos/pull/237)).

## [0.15.16] - 2026-08-09

### Fixed

- **Takumi MCP registration uses Takumi's first-class CLI.** Registering or
  removing Todos now calls scoped `takumi mcp add/remove` commands instead of
  the previously rejected generic path ([#233](https://github.com/hasna/todos/pull/233)).
- **Remote task creation is single-attempt and authority-verified.** Every
  create is read back by exact ID from the configured authority before success
  is printed, preventing duplicate or reported-but-unreadable task success
  ([#235](https://github.com/hasna/todos/pull/235)).
- **P1: partial task-manifest outbox delivery is retry-safe.** When a client
  acknowledged row 1, crashed or lost the response, then resumed the two-row
  sequence, the repeated row-1 acknowledgement was rejected as a graph
  conflict and row 2 could never be acknowledged. SQLite and PostgreSQL now
  treat an exact tenant-scoped row already in `delivered` state as success
  without changing its first delivery timestamp or attempt count; missing,
  wrong-tenant, cancelled, or otherwise incompatible rows still fail closed.
  The unchanged `todos.task-manifest.v1` capability now advertises
  `idempotent_outbox_delivery: true`, with a runtime guard that distinguishes
  older authorities where the field is absent or false.
- **Hosted exact task-list reads are complete or explicit.** Legacy unfiltered
  pages use bounded, stable `total`/`offset` pagination with matching-only
  output; incomplete or unsupported authority shapes fail closed instead of
  silently omitting matches ([#238](https://github.com/hasna/todos/pull/238)).
- **PostgreSQL outbox delivery and compensation no longer race.**
  Operation-scoped locking serializes delivery with compensation, and graph
  rollback proceeds only after every expected outbox row is atomically
  cancelled ([#240](https://github.com/hasna/todos/pull/240)).

## [0.15.12] - 2026-08-08

### Fixed

- **Remote `todos list` no longer reports an empty queue when `--status` is
  omitted.** The default pending-plus-in-progress filter was serialized as one
  comma-separated query; a contract-incompatible authority answered it with HTTP
  200, valid empty JSON, and no stderr even though both scalar status reads were
  populated. Multi-status cloud reads now issue bounded scalar queries, deduplicate
  their union by task ID, restore the global task order, and apply offset/limit last.

## [0.15.11] - 2026-08-08

### Fixed

- **Hosted guarded plan/project linkage now fails closed on invalid success
  payloads.** The cloud client validates complete nested plan, project, task,
  count, revision, receipt, digest, and rollback invariants before accepting an
  HTTP 2xx response, and normalizes idempotency keys before both the remote write
  and receipt validation so a successful mutation cannot be reported as a
  client-side failure ([#220](https://github.com/hasna/todos/pull/220)).

## [0.15.10] - 2026-08-07

### Added

- **Existing plans can now be linked atomically to one authoritative project.**
  Linkage validates exact plan, project, and member-task revisions; records
  immutable apply and rollback receipts with every prior task link; and enforces
  the chosen project for future plan members across SQLite, PostgreSQL, the v1
  API, SDK, and CLI ([#215](https://github.com/hasna/todos/pull/215)).

## [0.15.9] - 2026-08-07

### Fixed

- **SQLite project registration no longer rolls back unrelated successful task
  writes.** The 0.15.7 authority path awaited project/list discovery and digest
  work while a transaction remained open on the shared SQLite connection, so a
  later authority failure could roll back an ordinary supported task write that
  had already returned success. Registration now stages all asynchronous work
  outside the transaction, revalidates the exact read set, and applies the staged
  mutations atomically under `BEGIN IMMEDIATE`; forward and inverse fault
  regressions prove unrelated writes survive while concurrent authority calls
  serialize or retry safely ([#208](https://github.com/hasna/todos/pull/208)).
- **Ambiguous `todos list --assigned <name>` reads now disclose that the returned
  queue is partial.** Literal-only fallback remains non-fatal and preserves JSON
  stdout, but stderr now names the ambiguity instead of making a populated partial
  result indistinguishable from a complete queue
  ([#206](https://github.com/hasna/todos/pull/206)).

Containment: `0.15.7` remains deprecated and was removed from `latest`; the
registry intentionally stays on known-good `0.15.6` until this fix is released.
Version `0.15.8` was already reserved by a separate release lane and is skipped,
so `0.15.9` is the first releasable package containing the SQLite repair.

## [0.15.7] - 2026-08-07

### Added

- **Protected conditional project and task-list registration.** The package-owned
  `@hasna/todos/project-registration` SDK and authenticated `/v1/project-registration`
  routes create or bind an exact project/list pair under immutable request digests,
  deterministic retries, exact receipt readback, and bounded ambiguity reconciliation
  across SQLite and hosted PostgreSQL.

### Fixed

- **Registration compensation now refuses unsafe rollback.** Receipt-scoped
  compensation verifies ownership, parent state, and dependent records before removing
  an accepted registration, and refuses without mutation when foreign or user-created
  data would otherwise be detached or deleted.

## [0.15.6] - 2026-08-06

### Fixed

- **`show` and `inspect` advertised a comment cursor that no verb could spend, so every
  comment older than the newest page was unreachable from the CLI.** Both commands emit
  `comments_page` with `has_more: true`, a `next_cursor`, and `pagination_supported: true`,
  and both called `cloudListComments(cloud, id)` with no options — while that reader has
  accepted `{ limit, cursor }` all along and is unit-tested for it. `show --help` listed
  no options beyond `-h`, `--cursor`/`--comments-cursor` were rejected as unknown, and no
  `comments` verb exists (`comment` is write-only), so the advertised cursor had no
  consumer anywhere in the CLI. Measured on a live 125-comment task: the newest 100 were
  returned and the remaining 25 could not be read by any command. `show` and `inspect` now
  take `--comments-limit <n>` (1-500) and `--comments-cursor <cursor>`, so the cursor a
  page hands you is spendable by the command that produced it; walking that live task now
  yields 100 + 25 = 125 distinct comments with zero overlap and terminates at
  `has_more: false`. The local (SQLite) read path accepts the same flags with the same
  semantics through a shared pager; without a flag its output is unchanged — the complete
  history and no `comments_page` — so existing local consumers are unaffected.

  Note on the ordering, because the reported symptom pointed the other way: a page is the
  **newest** `limit` comments in **ascending** display order, so the newest comment is the
  **last** array element and was always reachable. `next_cursor` walks toward **older**
  history, which is the direction that was blocked. A `--comments-limit 1` read returns the
  single newest comment, which is the probe that distinguishes the two readings.

- **The comment cursor codec was private to the `/v1` server**, so the CLI could not decode
  a cursor the server had minted. `encodeCommentCursor`/`decodeCommentCursor` moved to
  `src/lib/comment-cursor.ts` alongside the pure pager both read paths now share; the
  server imports them and its behaviour is unchanged. A second copy of keyset logic is how
  the two ends drift into disagreeing about what a cursor means.

## [0.15.5] - 2026-08-05

### Added

- **`todos delegate` — one atomic verb for handing a task to a worker.** A delegation
  previously took four to six separate commands (`update --assign`, a comment carrying
  the brief, an `agents register` for the worker, a channel post), each of which could
  half-happen. Nothing tied them together, so a row could end up assigned with no brief,
  briefed with no assignee, or dispatched with no record anyone could grep. `delegate`
  performs the ordered effects in one call and refuses before the first write when the
  handover would be incomplete.
  - **A brief is mandatory and is gated on both sides.** `--brief <path>`,
    `--brief-text <text>`, or `--brief -` for stdin. A missing, unreadable, zero-byte or
    whitespace-only brief is refused with the offending path named and the row left
    byte-identical; the accepted content is stored untrimmed with its sha256, so a brief
    cannot be silently substituted later.
  - **Handover lineage is persisted on the row** — `assigned_by`, `delegated_from` and
    `delegation_depth`, written in a single patch. The write branches test
    `!== undefined` rather than truthiness, so `delegation_depth: 0` and an explicit
    `delegated_from: null` are honoured instead of being dropped. Depth increments from
    the parent row, so a re-delegated task records its chain.
  - **The row is left claimable.** `started_at` and `locked_by` stay `NULL` and status
    stays `pending`: delegation assigns and briefs, it does not claim. The worker's own
    `todos start` is still what takes the lock, which keeps the dispatched-but-unclaimed
    population countable.
  - **A greppable `[DISPATCH]` comment** carrying worker, dispatcher, brief source and
    digest, lineage, and the claim deadline — the marker is the first thing on the first
    line so counters can anchor on it. The deadline also lands in task metadata as a
    queryable field, merged read-modify-write so a concurrent writer's keys survive.
  - **Read-back verification.** After the patch the row is re-read and every field the
    delegation claims to have written is checked. If the authority accepted the request
    but did not persist the lineage, the command refuses and names the missing fields
    _before_ the `[DISPATCH]` comment is written, so a partial delegation can never be
    reported as a complete one. This matters most where `assigned_by` still holds the
    filer — a plausible value, which is what would otherwise make the no-op invisible.
  - **Depth threshold and embargo are data, not constants.** The threshold ships unset:
    the seat-queue count and any recorded override are unconditional, while parking is
    opt-in via flag, environment or config. The embargo is an owner-editable file that
    self-disables when absent, and it is enforced against both the worker's name and its
    agent id, since resolving an id to a name would otherwise bypass a name-only check.
  - Registered in both the canonical command list and the remote command list.
    Canonical-only would have left the verb local-only, which the `/v1` route refuses —
    a state that is invisible from `--help`.
  - `dispatch` and `dispatches` are unchanged and still registered. No schema change, no
    migration, and no change to any server route.

## [0.15.4] - 2026-08-04

### Fixed

- **`todos comment` ignored the per-session identity environment variable, so every
  unflagged comment was silently unattributable.** `todos comment <id> <text>` (alias
  `log-progress`) read `agent_id: globalOpts.agent` directly at both the cloud and the
  local `addComment` call site — a bare read of the `--agent` flag that never called
  `resolveWritableIdentity`. `add`, `start`, and `done` all already resolved through that
  helper, which checks the explicit flag first and then the two supported per-session
  variables `TODOS_AGENT_ID` and `HASNA_TODOS_AGENT_ID` (never the station-shared
  `identity.json`, which is not process-bound). Because `comment` never called it, that
  documented escape hatch was invisible on this one command: a comment written with the
  variable exported and no flag landed with `agent_id` null on the local store and
  attributed to the shared `fleet` principal on the cloud path — rc=0, printing
  `Comment added.`, with no warning that the attribution had been dropped. Both call
  sites now resolve through `resolveWritableIdentity(globalOpts.agent)`, matching the
  pattern `add` already uses: an explicit `--agent` still wins and keeps its original
  casing, and the resolver's canonicalised value is used only when no flag was passed.
  Regression coverage in `creator-attribution.test.ts` mirrors the existing `add` cases —
  attributes from the environment variable (this case fails without the fix), `--agent`
  still wins over the variable, stays null with neither, and never attributes from the
  persisted identity file (todos task `39b4255b`, PR #196).

## [0.15.3] - 2026-08-04

### Fixed

- **`todos add --assign <agent>` silenced the attribution warning while `created_by`
  went null.** After 0.15.2 routed `created_by` through the guarded
  `resolveWritableIdentity`, the ownerless-warning gate in `todos add` still keyed
  only on `assignee` — a check that used to imply attribution but no longer does. An
  anonymous filer that passed `--assign <agent>` got a real owner and a silently null
  `created_by`, because giving the row an assignee suppressed the one warning that
  would have said so. The warning now fires independently on whichever condition is
  true — no assignee, or no writable identity — so an assigned-but-unattributed row
  now says so on stderr instead of filing in silence (todos task `a3f4bb1a`).
- **`todos init`'s success message still promised automatic attribution that 0.15.2
  removed.** The line printed on every successful `init` — "Identity saved — later
  commands attribute to this agent automatically" — became false on every column
  (`created_by`, `agent_id`, `assigned_to`) once the persisted identity file was
  narrowed to a display-only diagnostic. The collision path already named the correct
  escape hatch (`export TODOS_AGENT_ID=<name>`); the success path — the one every
  fresh session hits — now prints the same instruction instead of the opposite one
  (todos task `a3f4bb1a`).

## [0.15.2] - 2026-08-04

### Fixed

- **`created_by` no longer inherits the station-shared identity `todos init` persists.**
  `todos add` and the MCP `create_task` tool resolved `created_by` through
  `resolveCreatorIdentity`, which falls back to `~/.hasna/todos/identity.json` — a file
  keyed on `$HOME` and shared by every agent session on a station, so it names the box
  rather than the caller. `agent_id`/`assigned_to` were already narrowed to the guarded
  `resolveWritableIdentity` in `0.14.x` (#142); `created_by` was deliberately left on the
  wider resolver on the premise that the change was inert on the hosted path because the
  deployed server dropped the column outright. That premise no longer holds — the server
  now persists and serves `created_by` — and the residual produced 489 real rows on one
  station misattributed to whichever agent last ran `todos init` there (todos task
  `9090972e`). `created_by` now resolves the same way as `agent_id`: unattributable
  (`null`) unless a process-bound identity (`--agent`, `--created-by`, `TODOS_AGENT_ID`,
  or `HASNA_TODOS_AGENT_ID`) is given.

## [0.15.1] - 2026-08-03

### Fixed

- **Cloud `link-ref` / `find-ref` round-trips now support refs containing `/` and
  `#`.** The v1 server decodes the opaque ref segment after route matching and returns
  a stable 400 for malformed percent encoding.
- **The npm release workflow no longer dirties its checkout during the full suite.**
  The model-config test restores the runner's original `HOME` instead of deleting it,
  preventing later config writes from creating a literal `~/.hasna/todos/config.json`
  inside the repository. A pre-publish cleanliness assertion now reports the path and
  stops before npm lifecycle hooks if this regresses.

## [0.15.0] - 2026-08-03

Numbered as a minor for the same reason `0.13.13` was renumbered to `0.14.0` the day
before: this release rejects CLI input that `0.14.0` accepted, and under 0.x semver the
minor is the field that signals that. A patch would have let a `^0.14` range absorb it
silently, which is the outcome the previous renumber existed to prevent.

The scope is narrower than `0.14.0`'s. That release rejected out-of-vocabulary enums on
`todos list` and on three HTTP endpoints, and it named those surfaces explicitly. It did
not cover `todos watch`, and it did not treat an empty or blank enum element as invalid.
Both gaps are closed here, so input that survived `0.14.0` can now fail.

### Added

- **`todos bulk tag|untag <ids...> --tag <comma-separated>`.** Adds or removes tags
  across many tasks in one invocation, on both the `/v1` and local SQLite paths.
  Previously `bulk` could reassign a plan across many tasks but could not tag them,
  and `todos tag` / `todos untag` take one id and one tag — so stamping a tag across a
  backlog cost one process per task.

  Semantics chosen so a large backfill is safe to run and safe to re-run:

  - **Merges, never replaces.** `todos update --tags` replaces the tag list; reusing
    that here would strip every unrelated tag from every row the run touched.
  - **Idempotent.** A row that already satisfies the request is skipped with no write,
    so a re-run after a partial failure does not bump row versions or emit audit noise.
  - **Fails closed** when `--tag` is absent, and when `--tag` and `--tags` are both
    given but name different sets — a silently dropped tag argument would report
    success while applying the wrong tags.
  - Tags split on commas only; `:` and `/` are preserved, which namespaced tags such as
    `repo:secrets` and `gh:hasna/todos` depend on.

### Changed

- **BREAKING (CLI): `todos watch --status` now validates its value against the status
  vocabulary.** `watch` shared `list`'s closed vocabulary and failed the way `list` used
  to: an out-of-vocabulary status matched no rows, so `todos watch --status open` painted
  a permanently empty dashboard that reads as "there is no work". This is worse than the
  `list` case it mirrors, because a live view invites an operator to sit and watch it.
  `watch` now exits non-zero and names the accepted vocabulary. Documented aliases
  (`done` -> `completed`) still resolve, so every previously _valid_ input behaves
  identically; only previously _invalid_ input changes, from a silent empty view at exit
  0 to a named rejection.
- **BREAKING (CLI): an empty or blank enum element is now rejected instead of being
  dropped.** `--status=` was parsed by Commander as an explicit empty string and fell
  back to the default filter at exit 0, and a blank list member meant `--status pending,`
  and `--priority high,,critical` were accepted as though a clean list had been typed.
  Both are almost always a stray comma or a shell expanding `--status "$A,$B"` with one
  variable unset, and in both cases the filter did not deliver what was asked for.
  Surrounding whitespace on a non-empty element (` pending , high`) stays tolerated,
  because that is a shape operators legitimately type.

### Fixed

- **`todos list` now applies its window after sorting rather than before**, so a bounded
  list returns the first N of the sorted result instead of an arbitrary N that was then
  sorted among itself. The remote scan is bounded by an explicit ceiling sent to the
  cloud API; the ceiling applies to the remote path by construction and never to local
  SQLite.
- **`todos list` no longer warns about an assignee it never queried.** The empty-result
  warning resolved the assignee separately from the query, so `--assigned <bogus>
--inbox` warned about a value that was never used as a filter, while
  `--agent-name "" --assigned <bogus>` stayed silent about the value that actually was.
  The effective assignee is now resolved once and read for both the filter and the
  warning.
- **`todos add` warns instead of silently filing a task with no project.** The local
  branch fell back to project auto-detection when `--project` was absent; the cloud
  branch did not, and the fleet runs cloud, so every fleet create stored a NULL project
  silently. Such a row appears in no per-seat list and no drain reaches it. Measured
  against the hosted store on 2026-08-03: 578 of 3231 pending rows (17.9%) carried a NULL
  project, and 93 of the 283 rows created in the preceding 24 hours (32.9%) did. It warns
  rather than rejects, deliberately — a third of live creations omit the project, so
  rejecting would take the CLI offline for that traffic. `--no-project` silences the
  warning, mirroring the `--unassigned` flag this command already ships for the same
  shape of problem on the assignee field. The cloud create also sends `working_dir`
  again, which the local branch had always sent.
- **`todos workflows`, `template-library`, `onboarding` and `sdk-fixtures` now serve
  their bundled static content on the `/v1` route** instead of exiting 1 with
  `REMOTE_COMMAND_UNSUPPORTED`, which is what `manual` — also bundled static — already
  did. The shipped manual documents `todos workflows` in its own examples. The four are
  admitted per invocation rather than wholesale: `onboarding --import` and
  `sdk-fixtures --show/--write` reach a store-backed import path, so those invocations
  are still refused rather than opening a route to SQLite where the local fallback is
  deliberately disabled.

## [0.14.0] - 2026-08-02

This release was prepared as `0.13.13` and renumbered before publishing. It carries a
breaking CLI change, and under 0.x semver the minor is the field that signals one — a
patch number would have let a `^0.13` range pick it up silently. No `0.13.13` was ever
published to npm; `0.13.12` is the version this supersedes.

### Changed

- **BREAKING (CLI and HTTP API): an out-of-vocabulary enum value is now rejected
  instead of returning an empty result.** Passing an unsupported value — the common
  case is a `--status` word that is not one of `pending`, `in_progress`, `completed`,
  `failed`, `cancelled` — previously produced a clean empty list that was
  indistinguishable from "no tasks matched", so a typo read as a true negative. The
  CLI now exits non-zero and names the accepted vocabulary, and three HTTP endpoints
  now answer **400** where they previously answered 200 with an empty list:
  `GET /v1/tasks` validates `status` and `priority`, and `GET /api/tasks` and
  `GET /api/tasks/export` validate `status`. `?status=open` is the canonical
  example. Any script or API client that depended on the silent-empty behaviour
  will start failing loudly; that is the intent.

### Fixed

- **Reaching any terminal status through the generic update path now releases the
  task lock.** Only `completed` did before, so `--status failed` and
  `--status cancelled` left `locked_by` and `locked_at` set permanently — a terminal
  task cannot be started again, so nothing could ever re-acquire the lock and clear
  it, and lazy repair-on-reacquisition could never reach the row. Both storage
  adapters are corrected; on the hosted adapter the hole was wider than first
  reported, having never released a lock for any terminal status including
  `completed`.
- The CLI now surfaces the server's own reason on a remote 400/4xx failure instead
  of swallowing it, so a rejected request explains itself rather than presenting as
  a generic failure.
- Registering an agent through the hosted path no longer mints a case variant of an
  existing name. This closes the remaining write path that could recreate the
  split-identity condition 0.13.12 fixed on the read side.
- **The MCP `rename_agent` and `rebalance_workload` tools now leave an ambiguous
  case-variant assignee alone instead of resolving it arbitrarily.** Where a database
  holds two distinct agents whose names differ only by case — the same split-identity
  condition the entry above closes at its source — `rename_agent` matched `assigned_to`
  case-insensitively and therefore moved _both_ agents' tasks onto the renamed one, and
  `rebalance_workload` indexed both roster rows under one lower-cased key, attributing
  those tasks to whichever row happened to be indexed last. `rename_agent` now widens to
  a case-insensitive match only when the old name uniquely identifies the agent being
  renamed, and uses an exact match when it does not; `rebalance_workload` marks a
  colliding alias ambiguous and skips those assignments rather than guessing. The
  observable difference on a database carrying such a collision is that `rename_agent`
  reports fewer updated tasks and `rebalance_workload` reports fewer moves — that is the
  wrong work no longer being done. This is not marked breaking because what it replaces
  was not a contract: in the colliding case the outcome was arbitrary — whichever roster
  row was indexed last — and no caller can have depended on it. It does carry one
  regression, named here rather than left to be found: `rename_agent`'s uniqueness guard
  resolves the old name through `resolvePartialId`, which treats any string of 36
  characters or more as a full UUID and looks it up on the `id` column, so it reports
  "not unique" for every agent name that long even when no collision exists. Such an
  agent's differently-cased task rows are now left on the stale name after a rename.
  Tracked as a follow-up.
- Multi-value task filters are now modelled correctly in the generated API schema
  (`style: form`, `explode: false`), so generated clients emit the **comma-separated
  single parameter** the server actually reads — `?status=pending,in_progress`. The
  server reads each filter with `searchParams.get()` and splits on `,`; it never calls
  `getAll`, so a client emitting a repeated parameter has only its first value honoured.

### Note

- **This release does not retro-clear task locks that already leaked.** That sweep is
  deliberately excluded rather than overlooked: clearing a lock bumps the row version
  and rewrites `updated_at`, and the change feeds page on `updated_at`, so sweeping
  the existing terminal rows would push every one of them through those feeds to
  repair something the reporting layer already handles. This release stops new leaks;
  the accumulated rows remain a separate, explicit decision.

## [0.13.12] - 2026-08-02

### Fixed

- Alias-resolve `assigned_to` on every remaining sibling exact-match call site
  (~20 sites behind one shared resolver), including a rebalance-load path where
  an overloaded agent's queue was silently undercounted. `assigned_to` has held
  an agent ID from one write path and a resolved name from another, plus case
  variants, so exact-match reads returned a silent subset. `#160` fixed the
  list filter; this closes the remaining call sites.
- **This is a local `bun:sqlite` fix.** Agents on the hosted API (`/v1`) are
  unaffected: the hosted service lacks Postgres equivalents for most of these
  code paths and runs an older client version regardless. This release changes
  nothing for hosted-mode agents.

## [0.13.11] - 2026-08-02

### Fixed

- `todos update --assign <seat>` now points callers at a `--assign-seat` invocation
  that actually runs. The prior refusal message named the flag in a shape the verb
  rejects, so an agent following it hit a second error and could conclude the CLI
  was recommending a broken flag. The corrected hint is client-side, so it reaches
  every installed agent immediately rather than waiting on the hosted service.

## [0.13.10] - 2026-08-02

### Fixed

- Starting a failed task through the versioned remote API now returns a deterministic
  `409 TASK_NOT_STARTABLE` response that explains the required reset to `pending`, and
  the CLI preserves that domain error instead of reporting the Todos authority as
  unavailable. Pending tasks continue to start normally on both SQLite and PostgreSQL.

## [0.13.3] - 2026-07-30

### Added

- **`@hasna/todos/testing` — a shipped test-isolation helper, so a consumer's test suite
  cannot write into the shared hosted store.** Measured on 2026-07-30, three repositories
  had between them left **2,094 rows** in the live authority purely from tests:
  1,151 from a consumer test suite (`Short ID resolution test`, `Scoped getTask resolution
test`, `seed-task-<epoch>` under `test-resolution-*` projects) and 943 `Merge the release
PR` rows from `hasna/loops`' `drain.test.ts`, which shelled out to the real `todos` CLI
  with an unmodified `process.env`. None was ever assigned, commented on, or actioned.
  The cause is the same in every case: the client resolves its transport from the
  environment, and every shell on a fleet machine exports the shared-store pointers.

  The export is `SHARED_TODOS_STORE_ENV_KEYS` (the routing variables, held as **one
  constant shared with the resolver that reads them** — including the legacy unprefixed
  API URL and key aliases a hand-rolled consumer copy reliably misses),
  plus `localTodosTestEnv()`, `applyLocalTodosTestEnv()` (with exact restore) and
  `assertLocalTodosTestEnv()`. It is published as a subpath so the list lives next to the
  resolver: a consumer-side reimplementation stops protecting anything the day this package
  adds a routing variable, and that failure mode is a green suite silently writing to
  production.

  Guarded by two tests that fail rather than drift: one regex-scans the resolver for every
  `TODOS_*` variable it reads and fails if any is neither scrubbed nor explicitly declared
  local-only; the other fails if the subpath ships without its declaration file.

### Fixed

- **`todos doctor` no longer reports healthy on a dataset full of orphaned rows.** In remote
  mode it returned a HARDCODED `ok: true` after checking only authentication and route
  availability, printed three green check marks and exited `0` — on the live authority that
  meant 10,176 orphaned tasks (4,735 of them still open) and 45 unbound task lists passed as
  healthy, which is why nothing else in that dataset was caught either. It already fetched
  every task list and every project and reduced them to `.length`, so the rows it needed were
  in hand and discarded. Neither mode ever counted a null or dangling `project_id` /
  `task_list_id`, and the local path never set a non-zero exit code even for an
  error-severity check.
- **The verdict is now derived from the counts that are printed.** Doctor counts six
  referential conditions (`tasks_without_project`, `tasks_without_task_list`,
  `tasks_with_unregistered_project`, `tasks_with_unregistered_task_list`,
  `task_lists_without_project`, `task_lists_with_unregistered_project`), one aggregate query
  each, and `ok` / the exit code are a pure function of those rows. A dangling reference is
  always an error; a null one escalates from warning to error once it hides OPEN work.
- **A condition that cannot be measured is never folded into "all clear".** It is reported as
  `NOT CHECKED` with the reason, and the report is INCOMPLETE.

### Added

- **Direct unit coverage for previously untested local task-runner and agent-task sync modules.**
  The tests exercise successful execution and synchronization as well as missing tasks,
  failed handlers, aborted runs, empty queues, malformed files, and unavailable paths.
- **`GET /v1/integrity`** — per-condition referential-integrity counts computed by the backing
  storage engine, for **both** SQLite and the Postgres JSONB record store (which has no
  foreign keys and is therefore where these rows actually accumulate). A backend that cannot
  answer returns `501` rather than a false clean. `TodosStorageAdapter.integrity` is
  implemented by both adapters.
- **`todos doctor --scan-tasks`** — remote-only, read-only paged walk of `/v1/tasks` that
  derives the task-level conditions when the authority predates the aggregate route
  (`/v1/tasks` filters cannot express `IS NULL`). A walk that cannot complete marks the
  conditions unverified instead of reporting a partial count as truth.

### Changed

- **BREAKING (exit code): `todos doctor` exit codes are now a verdict.** `0` clean · `1`
  findings (any orphan/dangling reference, or an error-severity check) · `2` incomplete (no
  findings, but a condition could not be measured). Advisory warnings (stale `in_progress`
  tasks, project paths missing on this machine, duplicate indexes) do not change the exit
  code. `--no-fail-on-findings` is the explicit opt-out for a consumer that gates on exit `0`;
  findings are still reported, and the printed exit code is always the one the process
  returns — a suppressed run prints `(exit 0 — findings gate suppressed by
--no-fail-on-findings; the verdict is 1)` rather than a `(exit 1)` the process never
  used. `doctor --json` gains an `integrity` block (`schema_version:
"todos.integrity.v1"`) plus `exit_code` (the status the process RETURNS),
  `verdict_exit_code` (the status the rows IMPLY) and `fail_on_findings`; `ok` keeps its
  name and finally means what it says.
- **Integrity findings are report-only.** `doctor --apply` repairs schema/hygiene only and
  never rewrites, deletes or re-points an orphaned row; `--apply` remains refused outright
  against a remote authority.

## [0.13.2] - 2026-07-28

### Fixed

- **`blocked_by` now means "tasks that block me" on every machine-readable surface —
  the inverted orientation deadlocked dependency chains** (task 4599ef37). `todos deps
<id> --json` (schema `todos.task_dependency_edges.v1`), `todos show/inspect --json`,
  `getTaskWithRelations`, and the self-hosted hydration all placed this task's
  DEPENDENTS in the field named `blocked_by`, while the human `Depends on:`/`Blocks:`
  output read the same data correctly. Schedulers consuming the JSON by name
  (@hasnaxyz/factory) therefore refused to dispatch the UPSTREAM task of every
  dependency chain with `dependency_unmet` — the chain deadlocked its own blocker.
  Now: `dependencies` = all prerequisites (upstream), `blocked_by` = the incomplete
  prerequisites currently blocking the task (empty ⇒ dispatchable; completed and
  cancelled prerequisites do not block, matching `getBlockedTasks`), and the
  dependents moved to a new `blocks` field (matching the human `Blocks:` label). The
  schema version stays `v1`: consumers pin it fail-closed, and the payload now finally
  matches what v1's field names always claimed. The `/v1/tasks/:id/dependencies` wire
  payload additionally carries the incoming edges under a new `blocks` key while
  keeping the deprecated `blocked_by` alias (same contents) so pre-0.13.2 fleet
  clients keep rendering `Blocks:` correctly; the CLI prefers `blocks` and falls back
  to the legacy name against older servers.

- **Secret redaction no longer destroys the clean value under a redacted key.** Once a
  secret-shaped object key was reduced to a pattern-specific placeholder
  (`[REDACTED_GITHUB_TOKEN]`, `[REDACTED_NPM_TOKEN]`), key-based redaction matched the word
  `TOKEN` inside the placeholder itself and replaced the untouched value beneath it with
  `[REDACTED]` — silent loss of non-secret data. Redaction is now idempotent for keys that are
  _entirely_ a placeholder. Keys of the form `NAME=[REDACTED]` are deliberately **not** exempt:
  that shape is what env-assignment redaction produces, and the value beneath it is opaque, so
  key-based redaction must still apply there. **Accepted trade-off:** a key named _literally_
  `[REDACTED_GITHUB_TOKEN]` / `[REDACTED_TOKEN]` / `[REDACTED_PASSWORD]` no longer has its value
  redacted by key name — previously it did, because the placeholder text contains `TOKEN` /
  `PASSWORD`. Such a key is indistinguishable from this module's own output, and keeping it
  exempt is what makes redaction idempotent.

### Known issues

- **Secret-bearing metadata _keys_ are not redacted on every write path.** `redactValue()`
  redacts metadata values but leaves key text intact; only `sanitizePreWriteValue()` rewrites
  keys. Task metadata is covered (via `sanitizeUpdateTaskInput`), but `task_findings.metadata`
  is built with `redactValue()` alone and persists a credential placed in key position — and
  `metadata_keys` is emitted in compact finding output, whose contract states that "metadata
  values are intentionally omitted", treating keys as the safe half. Pre-existing, not
  introduced here; tracked separately.

### Documentation

- **Documents pre-write secret sanitation, which has been active and undocumented since
  0.12.0.** Credential-shaped text in task `title`, `description`, `tags`, `metadata`, `reason`,
  comments, verification, dispatch, inbox, run and artifact payloads is redacted **before it is
  persisted**, not at display time. Consequences worth knowing: the original text is **not
  recoverable** — `show`/`inspect` return the stored, redacted value, and there is currently no
  `--raw` / `--no-redact` escape hatch. This supersedes the earlier contract (0.11.x) in which
  only broad `list`/`search` output was redacted while explicit detail output returned the raw
  value; the `redactBroadTask`/`redactBroadTasks` display layer still exists but can no longer
  observe an unredacted stored value. Legitimate text that merely resembles a credential (for
  example a note containing `Bearer <12+ chars>`) is redacted on write and cannot be restored.

## [0.13.1] - 2026-07-27

### Added

- **Machine-readable dependency reads.** `todos deps <id> --json` now returns a versioned,
  status-bearing edge payload (`schema_version: "todos.task_dependency_edges.v1"`) with
  `dependencies` (upstream prerequisites) and `blocked_by` (downstream dependents) as compact
  `{ id, short_id, title, status, priority, plan_id, project_id }` nodes — identical in local
  and self-hosted mode. New whole-project graph read `todos deps --project <ref> --json`
  (`schema_version: "todos.project_dependency_graph.v1"`) returns `nodes` + adjacency `edges` +
  `cycles` in a single call, so a scheduler can order a batch of tasks without one `deps <id>`
  call per task.

### Changed

- **BREAKING (CLI JSON contract): `todos deps <id> --json` output shape changed.** It previously
  emitted divergent, unversioned shapes — local returned full task rows under
  `dependencies`/`blocked_by`, while self-hosted returned bare `{ task_id, depends_on }` edges
  with no status. Both now emit the unified `todos.task_dependency_edges.v1` shape above (compact
  nodes; self-hosted gains id + status parity). Scripts that read fields only present on the full
  task row (e.g. `description`, `tags`, `created_at`, `metadata`) from `deps --json` must migrate to
  `show --json` / `inspect --json`. Human (non-JSON) output and `deps <id> --graph --json` are
  unchanged.

## [0.13.0] - 2026-07-25

### Security

- **`/api/*` and `/mcp` no longer fail open when no API key is configured.** `checkAuth`
  began with `if (!apiKey && !generatedKeysEnabled) return null; // no key configured,
skip auth`, so a server started without `TODOS_API_KEY` and without a stored key
  treated **every** request as authorized. On any deployment that binds a non-loopback
  host (e.g. `HOST=0.0.0.0` behind a load balancer) that published, to anonymous
  callers: `POST /mcp` (the full MCP tool catalog plus `tools/call` — create/start/
  complete/fail task, register agent, findings, run transactions), the entire `/api/*`
  REST CRUD surface (tasks, projects, agents, plans, orgs, templates, webhooks,
  pr-groups), the information-disclosing `/api/doctor` (internal database path) and
  `/api/headless` (boundary manifest), and the unbounded SSE streams `/api/events` and
  `/api/tasks/stream`. The MCP mount was already inside the auth choke point — the
  choke point itself returned "authorized".
  The unconfigured case now **denies**. A single startup decision
  (`resolveAuthPosture`, `src/server/auth-posture.ts`) resolves one of:
  - `enforce` — a credential source exists (`TODOS_API_KEY`/`--api-key`, or ≥1 stored
    key): every `/api/*` and `/mcp` request must present it;
  - `local-plane-disabled` — a hosted deployment (cloud `DATABASE_URL` configured, so
    the self-authenticating `/v1` plane works) with no local credential: `/api/*` and
    `/mcp` are not served at all (`404 LOCAL_PLANE_DISABLED`), while `/v1` and the
    health probes keep working, so closing the hole cannot cause an outage;
  - `anonymous-loopback` — explicitly requested via `--allow-anonymous` /
    `TODOS_ALLOW_ANONYMOUS=1` **and** a loopback bind host; anonymous requests are
    additionally required to come from a loopback transport peer (the check ignores
    `x-forwarded-for`, so `TODOS_TRUST_PROXY=1` cannot be used to spoof one). The
    stored-key check is re-evaluated per request under this posture, so
    `todos api-keys create` closes an already-open anonymous window without a restart;
  - otherwise the server **refuses to start**, exiting non-zero with an actionable
    error naming `TODOS_API_KEY` — starting wide open is never an option.
    `/v1` was not affected (it authenticates itself against the cloud API-key store) and
    `/health`, `/ready`, `/version`, `/openapi.json` remain public by design, so
    load-balancer and container health checks are unchanged.
    Regression coverage: `src/server/auth-fail-closed.test.ts` (unconfigured server exits
    non-zero and nothing listens; every `/api/*` read and write route, `POST`/`GET`/
    `DELETE /mcp`, and `/v1` reject a credential-less request; probes stay public) and
    `src/server/auth-posture.test.ts` (full posture matrix, including "no input ever
    yields an anonymous plane on an off-box bind").

### Changed

- **BREAKING (local):** `todos serve` / `todos-serve` with no `TODOS_API_KEY` and no
  stored API key now exits non-zero instead of serving `/api/*` anonymously. Migrate
  with `todos api-keys create "<name>"` (then send `x-api-key`), or, for loopback-only
  local development and the bundled dashboard, `todos serve --allow-anonymous`. The
  flag is refused for a non-loopback `--host`. `todos-mcp --http` is unchanged: it is
  loopback-pinned by contract, so it opts into the anonymous local plane implicitly
  (set `TODOS_API_KEY` to enforce auth there too).
- `src/test/local-routing-env.fixture.test.ts` also clears `DATABASE_URL` /
  `TODOS_DATABASE_URL` / `HASNA_TODOS_DATABASE_URL` / `TODOS_ALLOW_ANONYMOUS` so a
  live DSN or opt-in in a developer's environment cannot flip a local-intent test's
  auth posture.

### Docs

- `docs/hosted-auth-runbook.md` — posture matrix, the per-caller migration table, the
  owner-gated ECS redeploy steps (including that the deployed task definition sets no
  `TODOS_API_KEY`, so no new secret is required to close the hole), and post-deploy
  verification commands.

## [0.12.3] - 2026-07-25

### Fixed

- Remote `show`/`inspect` no longer report empty `dependencies`/`blocked_by` while `deps <id>` lists persisted edges (#58). The `/v1` task row endpoint returns no relation graphs, and the cloud detail assembly hard-coded both arrays to `[]`, so a blocked remote task looked unblocked and `inspect` never printed its `BLOCKED by N unfinished dep(s)` warning. `show`/`inspect` now read `GET /v1/tasks/:id/dependencies` and hydrate each referenced id into a full task row (deduplicated across both directions, bounded concurrency), matching local-mode output. An edge whose target task cannot be read degrades to an explicit `(unavailable task …)` placeholder instead of erasing the readable relations, and a dependency-endpoint failure warns on stderr rather than sinking the whole detail view (a `404`/`501` from a server without the route is silently treated as "no edges").

## [0.12.2] - 2026-07-25

### Fixed

- `todos bulk plan|move-plan --plan <id>` / `--clear-plan` now works under a remote (`self_hosted`/cloud) authority. Stage A rejected the whole invocation with `REMOTE_COMMAND_UNSUPPORTED` because the bulk handler resolved the plan reference through the local SQLite `resolvePlanId`, which is unavailable in remote mode. The cloud path now resolves the plan against the shared dataset (`cloudResolvePlan`) once, up front, so an unknown plan still fails closed before any task is mutated, and the Stage-A gate admits the two plan actions. Single-task `todos update <id> --plan` was already remote-capable; bulk reassignment is now at parity (#31).

## [0.12.1] - 2026-07-24

### Fixed

- SQLite task search no longer silently degrades or fails on queries containing punctuation. The `shouldUseFts` gate rejected any query with punctuation (e.g. `login: urgent`), falling back to a literal substring LIKE that matched nothing. A real FTS5 query parser now handles punctuation safely: AND-by-default terms, quoted phrases, and prefix matching, with FTS5 operator characters stripped/quoted instead of rejected.
- Task search is now bounded. `searchTasks` built its SQL with no `LIMIT`, so a broad query scanned/returned the whole table. It now applies a bounded default (1000) and honors an explicit `SearchOptions.limit`.

### Changed

- SQLite FTS ranking now uses `bm25()` column weighting (title >> description > tags), mirroring the Postgres `ts_rank_cd` A/B/C weights so both backends rank equivalently. The FTS path is unioned with the id/short_id/working_dir/metadata LIKE fallback so identifier/fingerprint/path pastes still resolve, with full-text hits ranked first.

## [0.12.0] - 2026-07-24

### Fixed

- Postgres full-text search parity (cloud/self-hosted returned nothing). `searchTasks` only ever queried the local SQLite FTS5 index, which is empty on a Postgres deployment. Task search now runs through the storage abstraction (`store.tasks.list({ query })`) so cloud/self-hosted executes a real Postgres query.

### Added

- `migrations/0006_task_fulltext_search.sql`: a weighted (`title`>`description`>`tags`) `tsvector` generated column on `todos_sync_records`, a GIN index for ranked full-text search, and a `pg_trgm` trigram GIN index for typo/fuzzy matching, all diacritics-insensitive via an immutable `unaccent` wrapper. Idempotent with automatic backfill; mirrored into `postgresTodosSyncSchemaSql` so fresh cloud bootstraps get it too.
- `TaskFilter.query` full-text field, honored by BOTH storage adapters so `GET /v1/tasks?q=` searches whether the server is Postgres- or SQLite-backed. The Postgres adapter emits a `websearch_to_tsquery` predicate (AND-by-default, quoted phrases, punctuation-tolerant) with a single-term `pg_trgm` word-similarity fuzzy fallback, ranked by `ts_rank_cd`; the local SQLite adapter routes the query through the FTS5 `searchTasks` path and applies the remaining filters. Exposed over `GET /v1/tasks?q=`; the `todos search` CLI routes through it under a self-hosted authority.

## [0.11.96] - 2026-07-24

### Security

- Remove internal production-infrastructure identifiers from the published open-source package. The managed database cluster name and the AWS Secrets Manager runtime path are no longer hardcoded in `src/storage/config.ts`; they are now supplied at runtime by the private hosting wrapper via `HASNA_TODOS_RDS_CLUSTER` and `HASNA_TODOS_RDS_RUNTIME_PATH`, and resolve to `null` when unset (no baked-in defaults).
- Scrub the internal cloud domain (`*.hasna.xyz`) from source comments, the `union-backfill` script default endpoint, and test fixtures; compose the private billing host in the headless outbound-boundary allowlist from parts so it is not shipped as a plaintext literal (the outbound guard still blocks it).
- Replace the real fleet machine identifier and private Tailscale/LAN addresses in the README machine-topology example with neutral placeholders.

### Changed

- **Breaking (public API):** `getCanonicalTodosRdsConfig()` now accepts an optional `env` argument and returns `cluster` / `runtimeSecretPath` as `string | null`. The exported constants `CANONICAL_TODOS_RDS_CLUSTER` and `CANONICAL_TODOS_RDS_RUNTIME_PATH` are replaced by `CANONICAL_TODOS_RDS_CLUSTER_ENV` and `CANONICAL_TODOS_RDS_RUNTIME_PATH_ENV`.

## [0.11.92] - 2026-07-18

### Fixed

- Route supported ordinary CLI coordination commands through the configured authenticated self-hosted `/v1` authority when remote storage mode is selected, before any local database adapter or ID helper can run.
- Fail closed on missing credentials, invalid or conflicting storage selectors, unsafe or incompatible authority URLs/routes, redirects, authentication errors, timeouts, and server failures; remote commands never fall back to SQLite.
- Make remote storage/status diagnostics HTTP-aware and harden release verification so a candidate must come from a clean tracked tree with commit/tree provenance and verified tarball integrity.
- Gate evidence-bearing remote completion on the authority's advertised OpenAPI contract, resolve short task references only from a stats-stable exhaustive snapshot, and preserve existing completion evidence atomically.
- Split public release verification into non-authoritative review and strict prepublish modes, pin Bun 1.3.14, verify tracked bytes/modes and packed binary provenance, and require two identical npm tarballs and payload manifests.

## [0.11.76] - 2026-07-06

### Fixed

- Auto project detection now skips disposable git roots under the system temp directory, preventing accidental registration of transient `/tmp` project shells.
- Added guarded `todos projects --deregister` support that preserves tasks and refuses to deregister any project with incomplete tasks.

## [0.11.75] - 2026-07-05

### Added

- `todos doctor routing` — deterministic routing-metadata drift detection (wrong/null `working_dir`, null/unresolvable `task_list_id`, invalid project paths, cross-repo intent, no-auto conflicts) with per-finding `repair_class` (`safe_auto` | `blocker_*` | `unsupported`), project-stable `--shard i/N` scoping, and a machine-consumable `--json` contract (`todos.routing_doctor.v1`) with documented exit codes (0 clean / 1 findings / 2 invalid invocation).
- `todos doctor routing --apply` — safe repairs for `safe_auto` findings only, via supported update paths (no raw DB edits), with a DB backup, per-task evidence comments, and an undo record carrying real per-repair undo commands.
- `todos update --working-dir <path>`, `--clear-working-dir`, and `--clear-list` — first-class routing-metadata repair and null-reset flags for existing tasks; `--list` now resolves exact UUID → partial UUID → project-scoped slug (UUID authoritative) and errors on unresolvable references instead of silently succeeding.
- `scripts/routing-health-scan.mjs` — deterministic OpenLoops command-loop consumer of the doctor JSON (deduped per-scope task upserts), and `scripts/routing-remediation.workflow.json` — validated planner → worker → adversarial-reviewer remediation workflow spec.

### Fixed

- `doctor routing --apply`/`--fix` reached the subcommand as a silent dry-run (Commander actionable-parent option shadowing); the flags now apply and are guarded by a CLI-level end-to-end regression test.
- Multi-megabyte `doctor routing --json` reports intermittently truncated when stdout was a pipe; now emitted through the flush-safe writer.

## [0.11.74] - 2026-07-05

### Fixed

- Task `route_state` made authoritative and aligned with the OpenLoops drain: the `auto:route`/`route:enabled` tag authorizes routing when `route_enabled` is unset; explicit denies and `no-auto` still deny. Added `route_class`, route evidence, and optional project-root verification (backfilled entry for the #37/#38 release).

## [0.11.73] - 2026-07-03

### Fixed

- **Security:** authenticate the `/mcp` endpoint and rate-limit it (and `/health`) — previously an unauthenticated write surface even with `--api-key` set. Preserves the 127.0.0.1-no-key default.
- **Security:** key the HTTP rate limiter on `server.requestIP`; honor `X-Forwarded-For` only under `TODOS_TRUST_PROXY` (was spoofable / shared "unknown" bucket).
- Task completion lifecycle: `completeTask` returns the correct post-commit version (was stale → follow-up updates conflicted) and is idempotent; completion via `updateTask`/PATCH/CLI now spawns recurrence exactly once and clears the lock; reopening clears `completed_at`; confidence preserved when omitted.
- `PATCH /api/tasks/:id` accepts a client version and maps conflicts→409 / not-found→404 (was last-write-wins / 500).
- `todos mcp` now starts a stdio server and bare `todos-mcp` defaults to stdio (register writers pass `--stdio`) — clients were booting HTTP and never speaking stdio.
- `--json` now works on `next`/`claim`/`status`/`fail`/`active`/`stale`/`redistribute` including empty results; added `log-progress` alias; typed not-found errors; CLI input validation.
- Removed phantom MCP tools from the registry, CLI/MCP parity manifest, and golden fixture; exposed `upsert_task` and metadata tools in profiles.
- `ensureSchema` backfills migration-48 columns; WAL-safe `restoreDatabase`; stable cursor ordering; `countTasks` mirrors `listTasks` filters; SDK no longer drops 4-byte bodies and authenticates `subscribe()`.

## [0.11.72] - 2026-07-02

### Added

- Multi-store route source discovery.

## [0.11.71] - 2026-07-01

### Changed

- Plan slug compatibility alignment and related maintenance.

## [0.11.70] - 2026-06-30

### Changed

- Maintenance and internal improvements (backfilled entry).

## [0.11.69] - 2026-06-29

### Fixed

- Keep large CLI JSON output complete when stdout is piped, including `todos list --json` and `todos list --format json` for large or status-filtered task lists.

## [0.11.59] - 2026-06-27

### Added

- Add deterministic task upsert support for loop/workflow automation.
- Emit richer task event metadata for task-created routing workflows.
- Expose task upsert through CLI, SDK, MCP, and HTTP API surfaces.

## [0.9.29] - 2026-03-12

### Performance

- Eliminate redundant `getTask()` re-fetches in `updateTask`, `startTask`, `completeTask` — saves 1 SELECT per mutation (33% fewer DB queries)

## [0.9.28] - 2026-03-12

### Performance

- Strip all 119 `.describe()` strings from MCP tool params (lean stubs pattern) — 90% cold start token reduction

## [0.9.27] - 2026-03-11

### Added

- CLI `--format=compact|csv|json|table` on `todos list` — compact is 95% fewer tokens than JSON

## [0.9.26] - 2026-03-11

### Changed

- MCP mutation responses (create/update/start/complete) now return compact 1-line format instead of 10-line detail — 80% smaller

## [0.9.25] - 2026-03-11

### Added

- REST API field filtering: `GET /api/tasks?fields=id,title,status` returns only requested fields — 60-80% smaller responses

## [0.9.24] - 2026-03-11

### Added

- `search_tools` and `describe_tools` MCP meta-tools for dynamic tool discovery (90-96% input token reduction)
- Trimmed 14 MCP tool descriptions to ≤60 chars

## [0.9.23] - 2026-03-11

### Added

- `@hasna/todos-sdk` — universal agent SDK package (TodosClient, OpenAI-compatible schemas)
- Agent discovery: `GET /api/agents/me` with auto-register, stats, assigned tasks
- Agent task queue: `GET /api/agents/:id/queue` sorted by priority
- Smart task claiming: `POST /api/tasks/claim` — atomically claim next available task
- Blocking dependency checks: `startTask` rejects tasks with unmet deps
- Completion evidence: `completeTask` accepts `{ files_changed, test_results, commit_hash, notes }`
- SSE event stream: `GET /api/events` for real-time task change notifications
- Auto-assignment: `findBestAgent()` assigns to least-loaded agent with role=agent
- `get_my_tasks` MCP tool for agent self-discovery

## [0.9.22] - 2026-03-11

### Changed

- README: comprehensive REST API docs (30+ endpoints), MCP tools reference (40 tools), CLI reference

## [0.9.21] - 2026-03-10

### Added

- Server API endpoints for audit log, webhooks, templates
- Dashboard activity feed showing audit log entries
- 61 new tests for audit, webhooks, templates, auto-audit

## [0.9.20] - 2026-03-10

### Added

- 11 new MCP tools: `get_task_history`, `get_recent_activity`, `create_webhook`, `list_webhooks`, `delete_webhook`, `create_template`, `list_templates`, `create_task_from_template`, `delete_template`, `approve_task`
- Auto-audit: task mutations (start/complete/update) automatically log to task_history
- CLI commands: `todos history`, `todos approve`, `todos templates`
- `--estimated` and `--approval` flags on `todos add` and `todos update`

## [0.9.19] - 2026-03-10

### Fixed

- Bulletproof migration system: `ensureSchema()` individually checks every table, column, and index on startup — handles fresh install, any upgrade path, partial migration recovery

## [0.9.18] - 2026-03-10

### Added

- Migration 10: audit log (`task_history`), webhooks, task templates, estimated time, approval workflow, agent permissions
- `logTaskChange`, `getTaskHistory`, `getRecentActivity` for audit trail
- `createWebhook`, `listWebhooks`, `deleteWebhook`, `dispatchWebhook` with HMAC signatures
- `createTemplate`, `listTemplates`, `deleteTemplate`, `taskFromTemplate`
- `estimated_minutes`, `requires_approval`, `approved_by`, `approved_at` on tasks
- `permissions` on agents (default `["*"]`)

## [0.9.17] - 2026-03-10

### Added

- Plans page in web dashboard with data table, markdown description, create/edit dialogs
- Plans can be attached to projects, task lists, or be free-standing
- Plans have owner agent (`agent_id`)
- Full REST API for plans: GET/POST/PATCH/DELETE /api/plans

## [0.9.16] - 2026-03-10

### Changed

- npm package published with public access
- Added `publishConfig.access: "public"` to package.json

## [0.9.15] - 2026-03-10

### Changed

- Open-source release polish: badges, dashboard/API docs in README
- Fix git clone URL, MCP server version, SECURITY.md versions
- Add repository, homepage, bugs, engines to package.json
- Remove self-dependency and postinstall

## [0.9.14] - 2026-03-09

### Added

- 27 new tests: lock expiry, partial ID resolution, updateAgent, getTaskListBySlug, ensureTaskList, server CRUD, export, bulk ops

## [0.9.13] - 2026-03-09

### Added

- Agent role field (migration 8) with admin/agent/observer roles
- `updateAgent()` function and `PATCH /api/agents/:id` endpoint
- Agents page: online/offline status, detail dialog, edit mode, role badges, last task, merge duplicates, comparison
- shadcn NavigationMenu for header navigation
- Help page moved to top-right as `?` icon button

## [0.9.12] - 2026-03-09

### Added

- Kanban view QoL: drag-and-drop, collapse/expand columns, priority filter, sort within columns, group by project, cancelled toggle, compact/detailed mode, inline actions, assignee avatars, hover preview, show more pagination

## [0.9.11] - 2026-03-09

### Added

- Auto-find free port when default 19427 is in use (scans up to 100 ports)

## [0.9.10] - 2026-03-09

### Added

- CLI: `todos count`, `todos bulk`, `todos watch`, `todos config`
- CLI: `--project-name`, `--agent-name`, `--sort` on `todos list`
- Better error messages with "Did you mean?" suggestions
- JSON error output when `--json` is active
- Kanban board view with table/kanban toggle

## [0.9.9] - 2026-03-09

### Added

- Card shadows removed across dashboard
- shadcn Select, Dialog, DatePicker components
- Task detail opens in dialog instead of inline
- Delete confirmation dialog
- CRUD endpoints for agents and projects in server
- Bulk delete for agents and projects
- Projects and agents pages: data tables with checkboxes, create dialogs, dropdown menus

## [0.9.8] - 2026-03-09

### Added

- Web dashboard (React/Vite/Tailwind/shadcn) served by Bun HTTP server
- Dashboard page with stats cards, completion rate, recent activity
- Tasks data table with search, filters, sorting, pagination
- Projects and agents data tables
- Task detail with markdown rendering
- Create/edit task dialogs
- Dark/light/system theme toggle
- Auto-refresh every 30 seconds
- Keyboard shortcuts (n, /, 0-4, r, Esc)
- Export CSV/JSON
- `todos-serve` binary and `todos serve` CLI command

### Changed

- Removed default LIMIT 100 from `listTasks()` — returns all by default

## [0.9.7] - 2026-03-08

### Added

- Completion guard: configurable throttling to prevent AI agents from faking task completions
  - 4 guards: status check, min work duration, rate limit, cooldown
  - Per-project overrides via config
  - `CompletionGuardError` with `retryAfterSeconds`

## [0.9.0] - 2026-02-28

### Added

- Agents with 8-char UUID identity system (migration 5)
- Task lists as named containers (migration 5)
- Task prefixes with auto-incrementing short IDs per project (migration 6)
- Comprehensive test coverage (295 tests across 14 files)

### Changed

- Integrated agents and task lists across CLI, MCP, and library surfaces

## [0.5.1] - 2026-02-15

### Added

- Full detail pages for tasks, plans, and projects
- Breadcrumb navigation on detail pages
- Tabbed editing interface

## [0.5.0] - 2026-02-15

### Added

- API key authentication with SHA-256 hashed keys
- Dashboard redesign with docs page, about/contact/legal pages
- Combobox, Tabs components
- Task detail dialog with tabs

## [0.4.0] - 2026-02-15

### Added

- Plans as first-class entity with CRUD across all surfaces
- URL-based routing in dashboard
- Dashboard home page with stats cards

## [0.3.7] - 2026-02-14

### Added

- Initial release with CLI, MCP server, and web dashboard
- Task management with optimistic locking
- Project management with auto-detection
- Full-text search, SQLite WAL mode
- Bidirectional sync with Claude Code, Codex, Gemini
