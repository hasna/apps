# Changelog

All notable changes to OpenLoops (npm `@hasna/loops`, repo `hasna/loops`) are
documented in this file. Version entries are generated from the
conventional-commit git history; one commit maps to one released patch version
unless noted.

## Unreleased

### Fixed

- **Merge-lane wedge — the task's own repository wins over a group-root
  `--project-path`:** commit 8ab2664 made the router-level `--project-path` win
  unconditionally in todos-task drains, so multi-repo routers that pass it as a
  concurrency group root (a non-repository directory such as the operator's
  home) sent every task to the group root and skipped it (`worktreeMode=required
  but projectPath is not an existing git repository`), zeroing merge dispatch
  fleet-wide. A drain
  now routes each task to its own first *usable* repository path (explicit
  `project_path`, metadata, the description's `Repository:` line, then
  `working_dir` — first that is a real git repo, probed once per path per tick);
  the router-level `--project-path` remains the rescue fallback for tasks whose
  recorded path is stale or broken (8ab2664's original intent). Registry drains
  are unchanged (the scanned source project still wins; task-controlled fields
  cannot redirect a route).
- **Route-disallowed tasks no longer burn the candidate window:** tasks bearing
  `no-auto`/`blocked`/`manual`-class tags can never route, but each occupied one
  of the bounded candidate rows every tick just to be rejected by eligibility —
  enough marked tasks starved a drain into `considered=N created=0` forever.
  They are now held out of the window before slicing (unless the drain's own
  `--tags` explicitly selects that tag) and counted as `excludedDisallowedTag`
  in drain reports, so the exclusion is auditable.
- **Deterministic gate deaths are bounded by a secondary ceiling:** gate deaths
  (runs that fail at worktree prep or a fast triage/planner gate before any real
  work) refund their redispatch attempt — correct for transient faults, but a
  deterministic fault would retry forever at the backoff floor. Work items now
  count consecutive gate deaths (`gate_deaths`, additive migration
  `0011_work_item_gate_deaths`, no schema `user_version` bump); at the ceiling
  (20) the item is dead-lettered — visible in drain reports — instead of
  spinning, and the bounded route re-admission will not requeue it. Any run
  that reaches the worker (success, productive failure, or an `exit 75`
  tempfail) resets the streak; `loops routes requeue` (default attempts reset)
  re-arms the full ceiling.

### Changed

- **Newer-schema databases soft-open when the delta is non-breaking:** an older
  binary used to refuse ANY database with a newer `PRAGMA user_version` — during
  the 2026-07-07 schema-8 lockout that bricked the whole CLI fleet over purely
  additive migrations. The database now carries a compatibility floor
  (`schema_compat.min_compatible_user_version`, raised only by BREAKING
  migrations; additive ones leave it untouched): a binary opens any newer
  database whose floor it meets, preserves the newer `user_version` stamp
  (never downgrades it), and refuses only on a known-breaking delta or when the
  floor row is absent (pre-contract/unblessed databases stay conservative).

## 0.4.18 (2026-07-07)

Drain reliability: kill the todos-task redispatch "black hole" family. A
still-actionable task whose runs kept finishing without closing it used to be
deduped forever once its attempt count reached the cap (`considered=N created=0`
with no signal), and purely infrastructural failures (a stale worktree
registration, a tempfail retry-signal) burned that cap on tasks that never
actually ran.

### Fixed

- **Redispatch cap no longer a silent black hole:** when a todos-task work item
  reaches `MAX_TODOS_TASK_ROUTE_REDISPATCHES` (8) it is transitioned to a
  visible `dead_letter` state instead of being deduped forever with no signal.
  Drain reports gain a `deadLettered` count (and the deduped result carries
  `deadLettered: true` + the reason), so a capped task is surfaced and an
  operator can requeue it rather than the drain silently reporting `created=0`.
- **Gate deaths no longer count toward the cap:** a run that dies before doing
  real work — worktree preparation failure, or a fast (`<60s`) `triage`/`planner`
  gate failure — has its attempt refunded by `finalizeWorkflowRun`, so an infra
  fault cannot dead-letter a task that never reached its worker.
- **`exit(75)` tempfail is requeueable, not dedupe-bait:** a step that exits 75
  (`EX_TEMPFAIL`, "retry later") drops its work item back to `queued` with the
  attempt refunded, so the "retry next tick" contract fires instead of leaving a
  terminal row that counts toward the cap.
- **`loops routes requeue` resets attempts by default:** an operator unwedge is
  now durable rather than one-shot (a capped item no longer re-caps after a
  single further terminal run). `--keep-attempts` preserves the count for the
  cautious path; the bounded route-path re-admission still preserves attempts so
  the cap keeps working.
- **Executor self-heals a stale worktree registration:** on git's "missing but
  already registered worktree" error, `ensureLocalWorktree` (and the remote
  worktree-prep script) now runs `git worktree prune` and retries the add exactly
  once — git's own prescribed remedy — before failing honestly. This removes the
  single biggest burner of the redispatch cap at its source.

### Changed

- Documentation now names `loops-serve` as the Postgres-backed Hasna-owned
  self-hosted control-plane host, keeps `loops-api` as the shared embeddable API
  contract, and reserves `cloud` wording for the hosted SaaS contract rather
  than the Hasna-owned self-hosted deployment.
- The cutover and migration docs now match the 0.4.14 self-hosted backend:
  `PostgresLoopStorage`, API-key auth, HTTP SDK, ARM64 deploy artifacts, and
  `loops-serve migrate` are shipped; long-running runner daemon mode, workflow
  execution over the runner protocol, and id-preserving remote import remain
  follow-up work.

## 0.4.15 – 0.4.17 (2026-07-06/07 — unpublished; first shipped with 0.4.18)

These three versions were committed to `main` with version bumps but never
published to npm individually; the 0.4.18 release is the first registry artifact
that carries them. Consolidated here so the published history stays honest.

### Added

- **0.4.15** — self-hosted client mode: the CLI routes loop reads/writes to the
  hosted `/v1` API when `self_hosted` mode is configured (#74).
- **0.4.16** — id-preserving bulk import endpoint (`POST /v1/import`) for
  self-hosted backfill, plus `loops self-hosted push --apply` in the CLI (#76).
- **0.4.17** — `GET /v1/loops/count` and `GET /v1/runs/count` endpoints (#77).
- Run receipt contract: run receipts table + API surface for verifiable run
  evidence (`migrations/0005_run_receipts.sql` mirror).

### Changed

- **SQLite schema `user_version` 7 → 8** via ledger migrations
  `0009_run_receipts` and `0010_work_item_machine_id` (additive; applied
  automatically on first open). NOTE: binaries older than this range refuse to
  open a migrated database ("schema version 8 is newer than this binary
  supports"), so downgrading below 0.4.15 after opening a database with this
  release requires restoring a pre-upgrade backup. A version-tolerance softening
  (open unless a known-breaking delta) is planned follow-up work.
- Launch-gated route drains: `--launch-gate`/`--launch-gate-blocker` hold a
  drain closed until named blocker tasks are completed.

### Fixed

- codewith agent JSON output parsing (#17).
- PR handoff: no-remote fallback repaired and handoff artifact errors scrubbed
  from templates.

## 0.4.14 (2026-07-06)

Self-hosted control-plane service brought to the full Hasna standard: all four
surfaces (CLI, MCP, serve, SDK) are real over the Postgres backend, with
internet-facing API-key auth and a deployable ARM64 image.

### Added

- **`loops-serve` HTTP control plane:** RDS-direct (Amendment A1) Postgres
  storage wired into the serve; public `GET /health`, `/ready` (storage
  reachable + fully migrated), `/version` (all `{status, version, mode}`) and
  `/openapi.json`; the versioned `/v1` loops + runs API is gated behind
  `@hasna/contracts` API-key auth (`verifyApiKey`, strict revocation via the
  shared `api_keys` table). `loops-serve migrate` applies the ledger-tracked
  schema + api_keys table.
- **Generated HTTP SDK:** `@hasna/loops/sdk/http` exports a typed dependency-free
  `LoopsClient` generated from `openapi/loops.json` (the serve contract).
- **Deploy artifacts:** ARM64/bun `Dockerfile` (Amazon RDS CA baked for
  verify-full TLS), `docker-compose.yml`, `hasna.contract.json` service
  manifest, and a `migrations/` mirror of the ledger migrations.

## 0.4.13 (2026-07-05)

`--pr-handoff` workflows whose worker pushes its own branch and opens the PR
directly (no handoff artifact — the cursor pattern) now complete instead of
failing the pr-handoff step and skipping the verifier.

### Fixed

- **pr-handoff — no-artifact/direct-PR path exited 1 instead of 0:** the step
  runs as `bash -lc` (a login shell). The no-artifact guard ended with an
  explicit `exit 0` while `set -e` was active; under systemd (`SHLVL` unset →
  bash sets 1) an explicit exit sources `~/.bash_logout`, whose `clear_console`
  fails without a controlling TTY, and errexit handed that failure back as the
  step's exit code. The workflow failed, the verifier (which depends on
  pr-handoff) was skipped, and the source task was stranded `in_progress`.
  Both guard branches now route through bun heredocs and fall through the `if`'s
  natural end — no top-level shell `exit` — so the intended status is preserved
  on the local and remote execution paths alike (gate steps already ended
  naturally, which is why only pr-handoff failed). (#34)

### Added

- **Worker-opened PR detection on the no-artifact path:** when no handoff
  artifact exists, pr-handoff now looks up the worker's own open PR for the
  workflow branch (`gh pr list --head <branch> --state open`), records the same
  `openloops:pr-handoff=done task=… pr=… commit=… branch=…` comment the
  artifact path records, and exits 0 — so direct-PR (cursor-style) completions
  carry PR evidence into the verifier and merge lane. Best-effort and
  fail-open on lookup: a missing PR or a `gh`/`git`/`todos` error is logged,
  writes no done-evidence, and never fails the step. The artifact (codewith)
  handoff path is unchanged. (#34)

## 0.4.12 (2026-07-05)

Drain throughput: `--max-active` is now a per-route ceiling instead of a
store-wide one, drain dispatch spreads across subscription accounts by live load,
and every step records the account it ran on.

### Fixed

- **Route admission — per-route `--max-active`:** the global admission count was
  store-wide, so the busiest router's `--max-active` became a shared ceiling that
  throttled every other router (average concurrency ~1.9 while the agent lane
  allowed 12; ~253 items/24h deferred as `global active workflow limit reached`).
  The global count is now scoped to the route/drain that set the limit; scope
  precedence is an explicit `--max-active-scope <key>` first, then the running
  loop's `LOOPS_LOOP_NAME`, then the route key as the final fallback — so each
  router's `--max-active` is its own ceiling.
  Existing routers get correct scoping with no config change. `project` and
  `project_group` counts are unchanged: they remain cross-route anti-hog caps.
- **Per-account attribution:** Codewith agent steps carry their subscription
  account in `authProfile`, not an `AccountRef`, so `workflow_step_runs.account_profile`
  was NULL for every drain worker and per-account burn could not be attributed.
  The resolved auth profile (and provider as `account_tool`) is now recorded on
  each step at run creation, and the per-role assignment is surfaced in drain
  reports.

### Added

- **Least-loaded auth-profile pool selection + `--max-per-profile`:** pooled
  Codewith dispatch picked a member by a pure hash of the work item, which stacked
  several concurrent workers on one account at high concurrency and tripped
  provider-side 429/stream-drop limits. Live drains now count running steps per
  account and place each route on the least-loaded pool member (verifier/planner
  still land on a different account than the worker; the hash is the deterministic
  tie-break, so a cold store reproduces the prior assignment). New
  `--max-per-profile <K>` (default 2 for pools of two or more, `0` disables) defers
  a route when every pool account already has `K` running steps.

Schema: additive sqlite migration `0008_work_item_route_scope` (nullable
`workflow_work_items.route_scope`; its index is created only by the migration —
never in the baseline DDL, which re-runs on every open and would crash pre-0008
databases). `SCHEMA_USER_VERSION` is intentionally not bumped so an older binary
can still open a database this migration touched (rollback-safe). Postgres gets
the equivalent additive migration `0004_work_item_route_scope`; the released,
checksummed `0002_workflows_goals` block is untouched so existing postgres
ledgers keep verifying. Upgrade coverage: a real pre-0008 (0.4.11 schema)
fixture database must open cleanly, gain the column + index, and keep its data;
released postgres migration checksums are pinned in tests.

## 0.4.11 (2026-07-05)

Scheduler fairness and PR-route hygiene: fast command loops no longer starve
behind long agent workers, PR tasks dedupe by GitHub identity, and merged/closed
PR routes close themselves out of the queue.

### Fixed

- **Daemon scheduler — separated concurrency lanes:** the daemon shared a single
  concurrency pool, so long agent/workflow workers (minutes to over an hour) could
  occupy every slot and starve fast command loops (monitors, digests, syncs) —
  even the merge router starved. Command-target and agent/workflow-target loops
  now draw from independent claim budgets. New env `LOOPS_DAEMON_COMMAND_CONCURRENCY`
  (default 4) and `LOOPS_DAEMON_AGENT_CONCURRENCY` (default 8); the legacy
  `LOOPS_DAEMON_CONCURRENCY` / `--concurrency` still work as the agent-lane knob for
  back-compat, and new `--command-concurrency` / `--agent-concurrency` daemon flags
  are added. A saturated lane no longer consumes the other lane's budget.
- **Todos-task routing — PR fingerprint dedupe:** the repos registry maps several
  local checkouts to one GitHub repo, so a single PR was minted as 2-3 duplicate
  todos tasks (distinct ids + checkout paths) that each dispatched a full worker.
  PR-subject tasks now dedupe by a stable `owner/repo#number` fingerprint (from an
  explicit PR fingerprint field or a canonical PR URL / `github-pr:` handle,
  lowercased) instead of the `(source-path, task-id)` key, collapsing the
  duplicates to one work item. Non-PR tasks keep the path/id key (no false dedupe).
- **Todos-task routing — freshness skip closes the task:** 0.4.10's freshness gate
  stopped dispatching a worker for a merged/closed PR but left the task pending +
  route-opted-in, so every drain tick re-skipped it forever. On a definitive
  MERGED/CLOSED freshness skip the drain now marks the source task done and strips
  its `auto:route`/`route:enabled` opt-in so it leaves the queue. Only fires when
  gh/metadata definitively reports MERGED/CLOSED; never on dry-run.

## 0.4.10 (2026-07-05)

Hotfix bundle for the PR-merge drain pipeline.

### Fixed

- **Todos-task drain:** re-admit a terminal work item whose todos task is still
  actionable (bounded by a redispatch cap + per-attempt backoff) instead of
  deduping it away forever, so real task work keeps dispatching.
- **PR review gate:** freshness gate skips merge/review routes for already
  merged/closed PRs; normalize `app/<slug>` and `<slug>[bot]` bot logins so
  bot-authored PRs resolve an author instead of hard-failing the format check.
- **Runtime/store:** cap persisted run stdout/stderr; project path resolution fix.

## 0.4.9 (2026-07-04)

Unblock the PR-merge pipeline: task-lifecycle/route workers now dispatch real
work, and the PR-review admission gate can resolve authors it was not handed.

### Fixed

- **Agent adapter / executor:** launch Codewith agent steps with non-interactive
  `codewith exec --json` instead of the durable `codewith agent start`
  background-agent controller. `agent start` reloaded the multi-megabyte rollout
  history on every turn, hitting `context_length_exceeded` and completing
  silently with no work — stalling task-lifecycle and route workers. exec runs a
  fresh session per invocation, honors `--auth-profile`, streams JSONL, and keeps
  network egress for gh/git (the `workspace-write` sandbox opts back into
  `sandbox_workspace_write.network_access`). Codewith is now a normal one-shot
  exec provider (remote-capable like codex); the unreachable durable
  start/read/logs/poll controller was removed.
- **Route PR review:** when a PR approval/merge route is required and no author is
  present in task metadata or text, derive the PR author from a concrete
  `owner/repo#number` reference via `gh pr view ... --json author` before
  selecting a non-author reviewer. Self-review protection is preserved (a derived
  author that matches the sole reviewer is still blocked), and the gate fails
  closed when the reference is unresolvable.

## 0.4.8 (2026-07-04)

Lifecycle prompt hardening for routed task workflows.

### Fixed

- **Task lifecycle routing:** render copy-safe triage and planner marker comment
  commands so agents can advance or block deterministic lifecycle gates without
  emitting a separate placeholder evidence comment first.

## 0.4.7 (2026-07-04)

Routing hardening for PR merge/drain automation.

### Fixed

- **Todos drain:** admit registered repo-project task sources while pinning
  routed work to the scanned source project, preventing task-controlled nested
  route paths from moving worker execution into another repository.
- **PR lifecycle routing:** propagate PR author and reviewer evidence into
  reviewer and merger lifecycle prompts so merge routing can select a valid
  non-author reviewer and keep reviewer/merger steps separate.

## 0.4.6 (2026-07-03)

Reliability hardening from a full audit of the runtime, control surfaces, and
todos routing integration.

### Fixed

- **Runtime:** repair a due slot that holds a terminal run (idempotent
  `advanceLoop`) so a daemon death between `finalizeRun` and `advanceLoop` can no
  longer wedge a loop into never running again.
- **Workflow runs:** recover dead-pid steps on resumed idempotent runs and wrap
  the step loop so an unexpected error finalizes the run `failed` instead of
  leaving it `running` forever.
- **Runner:** abort execution after repeated heartbeat failures on a lost lease.
- **Daemon:** `stopDaemon` terminates a live pidfile process even when its lease
  is expired/mismatched; startup inline-owner check verifies kernel start time.
- **Store:** `deleteLoop` removes child run history; `finalizeRun` guards
  `status='running'`; ambiguous-name resolution ignores archived namesakes;
  rerunning a terminal manual goal creates a fresh goal.
- **CLI/API/SDK/MCP:** add `daemon logs --tail`; `PATCH /v1/loops/:id` no longer
  wipes schedule fields or 500s; resume-from-stopped recomputes `nextRunAt` so the
  loop is actually due; mutation paths reject ambiguous names; numeric flags are
  validated.
- **Routing:** honor the `route:enabled` opt-in tag; surface fatal drain errors
  (non-zero exit, `fatal` count) instead of a green route-nothing run; tag routed
  failure tasks `loops` and emit the correct `todos task upsert` command.

## 0.4.5 (2026-07-03)

Upgrade-path fix for existing `0.4.1`-era local stores.

### Fixed

- Opening a version-6 store now applies the `0007_run_claim_tokens` migration
  before creating the `claim_token` index. This fixes upgrades where
  `loops doctor`, `loops daemon status`, or daemon restart failed with
  `no such column: claim_token` on machines that already had active OpenLoops
  state.

## 0.4.4 (2026-07-03)

Self-hosted runtime MVP release for operator-owned OpenLoops control planes.

### Added

- Postgres storage contract with checksum-ledgered migrations for loops, runs,
  workflows, goals, runner machines, runner leases, and audit events.
- Storage-backed `loops-api` `/v1` foundation for loop CRUD, run reads, runner
  registration, claim, heartbeat, finalize, and bounded evidence upload.
- `loops-runner` foundation with self-hosted status checks and one-shot
  claim/execute/finalize support for non-workflow loop targets.
- Operator-safe migration bundle helpers and CLI/SDK previews:
  `loops export`, `loops import`, `loops self-hosted migrate --dry-run`,
  `loops self-hosted push --dry-run`, `loops self-hosted pull --dry-run`, and
  preview-first `loops self-hosted runner-register`.
- Documentation for self-hosted API/runner boundaries, local cache/spool
  semantics, id-preserving import blockers, rollback evidence, and
  cross-machine rollout evidence.

### Safety

- Remote self-hosted push/pull/migrate remain preview-only until the control
  plane exposes table-preserving import/sync coverage for every supported
  durable table, or a reviewed restricted rollout proves unsupported rows are
  absent.
- Non-local API and runner paths fail closed without bearer tokens, run output
  remains redacted by default, and migration/import planning blocks live
  destination state, tampered bundles, and redacted environment imports unless
  explicitly allowed.
- The npm `prepublishOnly` gate now runs build, typecheck, full tests, and the
  private-boundary scan before publishing.

## 0.4.3 (2026-07-03)

Registry-visible self-hosted API and runner protocol patch. The local Git tag
set currently has no `v0.4.3` tag, so this entry backfills the release evidence
from the branch history and npm registry.

### Added

- Storage-backed `loops-api` routes for loop CRUD and run listing using the
  public storage contract, with storage-backed routes failing closed when no
  storage adapter is injected.
- Runner registration, claim, heartbeat, finalize, and bounded evidence upload
  protocol endpoints for self-hosted control planes.
- `loops-runner run-once` execution path for claimed non-workflow loop runs,
  including claim-token fencing and heartbeat coverage while a run executes.

### Safety

- Non-local API serving requires a bearer token.
- Runner claims skip workflow loops until remote workflow execution is fully
  supported.
- Run listing redacts stdout/stderr unless explicitly requested.

## 0.4.2 (2026-07-03)

Registry-visible self-hosted storage contract patch. The local Git tag set
currently has no `v0.4.2` tag, so this entry backfills the release evidence
from the branch history and npm registry.

### Added

- Async storage contract for local and self-hosted runtime adapters.
- SQLite storage wrapper over the existing local `Store`.
- Postgres storage migration contract with checksum ledger, core loop/run
  tables, workflow/goal tables, runner machine/lease tables, and audit events.
- Public package exports for storage contract, SQLite adapter, Postgres adapter,
  and Postgres schema helpers.

### Safety

- `loops-runner` self-hosted status fails closed when a remote runner is
  configured without the required API URL and token.

## 0.4.1 (2026-07-03)

Contract-foundation release for the Mailery-style local/self-hosted/cloud
deployment split.

### Added

- Deployment-mode contract docs covering `local`, `self_hosted`, and `cloud`
  authority, cache/spool, API, runner, and hosted-boundary semantics.
- Public mode resolver and status helpers exported from `@hasna/loops` and the
  `@hasna/loops/mode` subpath.
- CLI status surfaces: `loops mode`, `loops self-hosted status`, and
  `loops cloud status`.
- Foundation binaries and package subpaths for `loops-api` / `@hasna/loops/api`
  and `loops-runner` / `@hasna/loops/runner`.
- Private-hosted-boundary test coverage to keep hosted implementation details
  and obvious credential patterns out of the public package.

## 0.4.0 (2026-07-02)

Audit-hardening release: write-path secret scrubbing, process-group reaping,
gated schema migrations, storage garbage collection, and a consolidated
CLI/MCP/SDK surface with deprecation aliases.

### Security

- Write-path secret scrubbing (`src/lib/redact.ts`): persisted run/step
  errors, goal evidence, raw model responses, and run envelopes pass through
  `scrubSecrets`/`scrubSecretsDeep` before storage. Recognized credential
  shapes — Anthropic `sk-ant-*`, OpenAI `sk-proj-*`, AWS `AKIA*`, GitHub
  `ghp_*`/`github_pat_*`, Slack `xox?-*`, PEM private key blocks, and generic
  `KEY="..."` assignments with high-entropy values — are replaced with
  `[SCRUBBED]`. Scrubbing is idempotent and bounded for large (256KB+)
  payloads.
- MCP shell removal: `loops_create_command` now takes a structured
  `command` + `args` argv only. The former `shell` boolean is rejected
  (schema `z.never()`) instead of being silently stripped — shell loops
  remain a human decision via the CLI. Mutation tools stay double-gated
  behind `LOOPS_MCP_ALLOW_MUTATIONS=true` plus per-call confirmation.
- Archived-loop guards centralized in the store: `updateLoop` throws a coded
  `LoopArchivedError` for archived loops (except the explicit unarchive
  path), so CLI, MCP, SDK, daemon, and scheduler all share one enforcement
  point instead of per-surface checks.
- Executor-enforced git worktrees: when a target carries worktree metadata,
  the executor prepares/verifies and enters the worktree before spawning the
  child (locally and on remote machine dispatch), records the entered
  worktree, and `worktreeMode=required` fails closed instead of falling back
  to the original checkout.
- Coded error classes (`src/lib/errors.ts`): `LoopNotFoundError`,
  `LoopArchivedError`, `AmbiguousNameError`, `ValidationError`, each with a
  stable `.code` so callers branch on codes instead of message text.

### Reliability

- Run lease re-acquisition: runners heartbeat their lease
  (`heartbeatRunLease`, every `leaseMs/3` capped at 60s) and the store
  records the child process identity (`recordRunProcess` with pid/pgid/
  process start fingerprint) so recovery can tell live runs from dead ones.
- Orphan reaping: after startup and periodic lease recovery, the daemon
  signals the process groups of abandoned runs (SIGTERM, then SIGKILL after
  a grace period) using the pid/pgid + start-time fingerprints returned by
  `recoverExpiredRunLeases`; unfingerprinted pids are never trusted or
  signaled.
- Retry backoff with jitter: exponential
  `retryDelayMs * 2^(attempt-1) * (0.5 + random)`, capped at 6h;
  rate-limit/auth failures back off 4x harder.
- Circuit breaker: after 5 consecutive final failures (default,
  configurable/disableable) the loop auto-pauses with a health-visible
  skipped marker run explaining the trip; `loops resume` re-arms it and
  requires a fresh failure streak before tripping again.
- Default idle watchdog for agent targets: agent runs that set neither
  `timeoutMs` nor `idleTimeoutMs` now time out after 30 minutes without
  observable progress (4 hours for buffered agents); override with
  `idleTimeoutMs` or `LOOPS_AGENT_IDLE_TIMEOUT_MS`. Timeouts kill the
  child's entire process group, not just the direct child.
- Daemon logging: every line is timestamped `[ISO8601] [loops-daemon] ...`,
  and `daemon.log` rotates at 50MB.

### Storage

- Gated schema migrations: migrations are tracked in `schema_migrations` and
  the database stamps `PRAGMA user_version` (now 6). Older 0.4.x+ binaries
  refuse to open a newer database instead of silently misreading it;
  baseline 0.3.x migrations are re-applied idempotently to converge drifted
  databases (including the known live fork with orphan
  `loops.metadata_json`/`loop_runs.source` columns).
- `Store.pruneHistory({ maxAgeDays?, keepPerLoop?, dryRun? })` deletes old
  terminal run history in bounded batches and returns a deletion summary;
  exposed as the new `loops gc` command (dry-run by default, `--apply` to
  execute) which also rotates database backups, checkpoints the WAL, and
  removes stray temp files.
- Online backups via `VACUUM INTO` (`src/lib/backup.ts`):
  `backupDatabase({ reason, keep = 3 })` with a per-reason 1h debounce and
  retention pruning; destructive CLI operations (rename, name-hygiene apply)
  snapshot the database first.
- Bounded run envelopes (`src/lib/run-envelope.ts`): persisted stdout/stderr
  excerpts are capped (2048 chars per excerpt) and scrubbed, keeping run
  rows small and secret-free.
- Time-sortable ids: `genId()` now returns a 128-bit ULID-like id — 48-bit
  millisecond timestamp prefix + 80 random bits, 32 lowercase hex chars —
  so primary keys sort by creation time while staying compatible with
  existing TEXT keys.

### CLI / MCP / SDK

- CLI: new `loops gc`; `routes` is the canonical event-routing surface.
  Deprecated aliases retained for one release cycle: `loops events
  handle|drain ...` (use `loops routes create|drain`), `loops templates
  create` (use `loops workflows create --template <id>`), and `loops goal
  status` (merged into `loops goal show`). Internal debloat consolidated
  ~1,900 lines of template code and moved route/template plumbing into
  `src/lib/route/` and `src/lib/template-kit.ts` without removing any
  non-deprecated command.
- MCP: tools renamed to a canonical `loops_*` namespace (e.g. `loop_runs` →
  `loops_runs`, `workflow_read` → `loops_workflow_read`); every legacy name
  is still registered as a deprecated alias. New read-only tools:
  `loops_health`, `loops_diagnose`, `loops_daemon_status`,
  `loops_workflow_run_inspect`; new guarded mutations: `loops_stop`,
  `loops_archive`, `loops_unarchive`. A golden-schema test
  (`src/mcp/golden-schema.test.ts`) pins the exported tool schemas.
- SDK: `LoopsClient.list()` accepts status/limit/archived filters;
  `runs(idOrName?, { status?, limit? })` resolves names and returns `[]` for
  unknown loops (v0.3.x-compatible polling); new `doctor()` and `health()`
  reports; `pause`/`resume`/`stop` surface the store's coded
  `LoopArchivedError`.
- Root export (`@hasna/loops`) is now a curated, documented API surface
  (SDK client, MCP factory, coded errors, domain types, doctor/health
  helpers) instead of `export *` of internals.
- Packaging: `@hasna/machines` moved to `optionalDependencies`; `prepare`
  only builds when `dist/` is missing; `CHANGELOG.md` ships in the npm
  package; full Apache-2.0 license text restored in `LICENSE`; CI workflow
  added (`.github/workflows/ci.yml`).

### BREAKING / UPGRADE NOTES

- **Database version stamp — plan downgrades before upgrading.** The first
  0.4.0 process to open a loops database applies migration 0006 and stamps
  `PRAGMA user_version = 6`. Migrations are additive (no columns dropped),
  and 0.3.x binaries do not check `user_version`, so rollback generally
  works — but downgrading after 0.4.0 has written process-identity data is
  unsupported and untested. Take a copy of `loops.db` (or rely on the
  automatic `VACUUM INTO` backups) before upgrading shared machines.
- **Root import surface narrowed.** `@hasna/loops` no longer re-exports
  every internal symbol. If you imported undocumented internals from the
  package root, switch to the curated exports or the `./sdk`, `./mcp`, or
  `./storage` subpaths. `./storage` (raw `Store`) remains internal plumbing
  and may change without notice.
- **Coded errors replace message-matching.** SDK/store mutations on
  archived or missing loops now throw `LoopArchivedError` /
  `LoopNotFoundError` (with `.code`) instead of plain `Error`s with ad-hoc
  messages. Update any `error.message.includes(...)` checks.
- **`LoopsClient.runs()` signature changed** from `runs(loopId?)` to
  `runs(idOrName?, filters?)`; it now resolves loop names and returns `[]`
  when the loop does not exist.
- **`genId()` no longer takes a length argument** and always returns 32
  chars. Existing shorter ids remain valid; code that assumed 12-char ids
  must not.
- **MCP `loop_create_command` requests that include `shell` are rejected**
  with a validation error instead of the flag being ignored. Remove the
  field and pass argv-style `command` + `args`.
- **MCP tool names changed** to `loops_*`; legacy names (`loop_runs`,
  `loop_pause`, `workflow_read`, ...) still work as deprecated aliases but
  will be removed in a future minor. Re-list tools and migrate callers.
- **CLI deprecations** (aliases still work, removal planned): `loops events
  handle|drain` → `loops routes create|drain`; `loops templates create` →
  `loops workflows create --template <id>`; `loops goal status` → `loops
  goal show`.
- **Agent loops can now time out by default.** Previously an agent target
  with no `timeoutMs` could hang forever; it now idle-times-out after 30
  minutes without progress (4h for buffered agents). Long-running agents
  must set `timeoutMs`/`idleTimeoutMs` explicitly or export
  `LOOPS_AGENT_IDLE_TIMEOUT_MS`.
- **The daemon reaps abandoned process groups.** Inline/external runners
  must keep the `<surface>:<pid>` runner-id shape and record process
  identity through the scheduler so a starting daemon can see the owner is
  alive; runs claimed without fingerprints are re-queued on lease expiry
  (their processes are never signaled without a verified fingerprint).
- **Failing loops auto-pause.** After 5 consecutive final failures the
  circuit breaker pauses the loop with a `circuit breaker open` marker run;
  fix the cause and `loops resume` the loop. Monitoring that expects
  endless retries should watch for these markers.
- **Bun is the only supported runtime** (`bun >= 1.0` on PATH even under
  npm installs), and `@hasna/machines` is now an optional dependency —
  installs without it simply disable remote-machine assignment.

## 0.3.60 (2026-07-01)

Experimental Codewith durable-agent controller for long workflow steps.

### Fixed

- **Codewith executor:** run Codewith agent steps through the durable
  `codewith agent start` background-agent lifecycle with rollout progress
  recording into workflow step runs.

Superseded in **0.4.9**: task-lifecycle and route workers now dispatch Codewith
via non-interactive `codewith exec --json` because `agent start` reloaded
multi-megabyte rollout history every turn and stalled workers with silent
`context_length_exceeded` completions.

## 0.3.59 (2026-07-01)

Harden append-only workflow goal-wrapper migration.

### Fixed

- **`migrate-goal-wrappers`:** dry-run and apply paths now use compact migration
  summaries, block retarget while a loop run is active, and route failures
  through `cloneWorkflowWithoutGoalAndRetargetLoop` so only loops with both a
  loop-level goal and a workflow-level top-level goal migrate.
- **Store:** `cloneWorkflowWithoutGoalAndRetargetLoop` inserts a goal-free
  workflow spec, retargets the loop, and optionally archives the old spec when
  unreferenced — matching the append-only semantics of
  `migrate-agent-timeouts`.

## 0.3.58 (2026-07-01)

Break nested workflow goal deadlocks and add a migration path.

### Fixed

- **Workflow loops — nested top-level goals:** a loop-level goal wrapping a
  workflow that also defined a top-level `"goal"` deadlocked because each layer
  waited on the other. New workflow loops that combine both wrappers are
  rejected at creation; retargeting onto a dual-goal workflow is blocked. When
  only a legacy dual-wrapper loop remains, the runner strips the workflow goal
  for execution so the loop-level goal can drive orchestration.
- **Workflow runner:** loop-level goals on workflow loops execute the underlying
  workflow with the workflow-level goal removed when both were present.

### Added

- **`loops workflows migrate-goal-wrappers`:** append-only migrator that clones
  a goal-free workflow spec and retargets eligible non-running workflow loops
  that still carry redundant workflow-level goal wrappers alongside a loop-level
  goal. Supports `--loop`, `--apply`, and `--archive-old` like
  `migrate-agent-timeouts`.

## 0.3.x

Compact history for the 0.3 line, newest first (`version (date) commit subject`).

- 0.3.57 (2026-07-01) feat: harden loop routing and add MCP server
- 0.3.56 (2026-06-30) fix: allow worktree agents to write git metadata
- 0.3.55 (2026-06-30) fix: agent workflow timeout policy
- 0.3.54 (2026-06-29) feat: add prompt-file support for agent loops
- 0.3.53 (2026-06-29) fix: refresh route invocation metadata safely
- 0.3.52 (2026-06-29) feat: add full task lifecycle route template
- 0.3.51 (2026-06-29) fix: harden custom template registry
- 0.3.50 (2026-06-29) feat: add custom templates and loop rename
- 0.3.49 (2026-06-29) fix: harden workflow route lifecycle
- 0.3.48 (2026-06-29) fix: harden loop routing and recovery
- 0.3.47 (2026-06-29) fix: validate agent loop options before storing
- 0.3.46 (2026-06-29) fix: harden generic and cursor agent routes
- 0.3.45 (2026-06-29) fix: allow routed task workflows to update app stores
- 0.3.44 (2026-06-29) fix: harden loop readiness adapters
- 0.3.43 (2026-06-28) fix: refresh stale generated route workflows
- 0.3.42 (2026-06-28) chore: refresh loops cli release
- 0.3.41 (2026-06-28) fix: give routed task agents exact todos project commands
- 0.3.40 (2026-06-28) fix: migrate workflow run invocation indexes safely
- 0.3.39 (2026-06-28) chore: release loops 0.3.39
- 0.3.38 (2026-06-28) docs: require worktrees for routed repo tasks
- 0.3.37 (2026-06-28) docs: require worktrees in routed examples
- 0.3.36 (2026-06-28) fix: treat configured project path as fallback
- 0.3.35 (2026-06-28) fix: prefer task repository paths for routing
- 0.3.34 (2026-06-28) fix: infer task repo paths during drain
- 0.3.33 (2026-06-28) feat: compact todos drain output
- 0.3.32 (2026-06-28) fix: read todos drain queues from file
- 0.3.31 (2026-06-28) fix: handle large todos drain queues
- 0.3.30 (2026-06-28) fix: dedupe task routes across prefixes
- 0.3.29 (2026-06-28) feat: filter drained tasks by project path
- 0.3.28 (2026-06-28) feat: drain ready todos task workflows
- 0.3.27 (2026-06-28) feat: throttle task event workflows
- 0.3.26 (2026-06-27) feat: add safe auto routing for loop tasks (includes Cursor Agent CLI adapter fix, PR #10)
- 0.3.25 (2026-06-27) fix: redact routed health evidence
- 0.3.24 (2026-06-27) feat: add runtime loop preflight
- 0.3.23 (2026-06-27) feat: preflight event workflows
- 0.3.22 (2026-06-27) feat: preflight loop creation
- 0.3.21 (2026-06-27) fix: rotate routed loop findings and tighten task routing
- 0.3.20 (2026-06-27) feat: route loop hygiene findings to todos
- 0.3.19 (2026-06-27) fix: back up loop database before name hygiene apply
- 0.3.18 (2026-06-27) fix: harden loop hygiene routing gates
- 0.3.17 (2026-06-27) feat: add loop health and hygiene abstractions
- 0.3.16 (2026-06-27) chore: release loops 0.3.16 (includes gated todos task routing eligibility and loop health expectations)
- 0.3.15 (2026-06-27) feat: archive loops and route task events through account pools
- 0.3.14 (2026-06-26) chore: release loops 0.3.14 (includes deduped todos task event routing)
- 0.3.13 (2026-06-26) feat: event-driven workflow templates
- 0.3.12 (2026-06-25) fix: invoke Cursor agent subcommand
- 0.3.11 (2026-06-25) chore: release 0.3.11 (includes fix(store): make additive column migrations idempotent)
- 0.3.10 (2026-06-24) feat: run daemon loop jobs concurrently
- 0.3.9 (2026-06-24) fix: strict goal response schemas
- 0.3.8 (2026-06-22) feat: derive CLI version from package metadata
- 0.3.7 (2026-06-22) feat: add transcript-driven loop workflow
- 0.3.6 (2026-06-21) feat: add AI SDK goal orchestration
- 0.3.5 (2026-06-20) fix: avoid login shell for remote machine loops
- 0.3.4 (2026-06-20) feat: add OpenMachines loop assignment
- 0.3.3 (2026-06-20) fix: harden OpenLoops daemon ownership and redaction
- 0.3.2 (2026-06-19) feat: add codewith auth profiles and run-now exit codes
- 0.3.1 (2026-06-19) fix: loops daemon path and output bugs
- 0.3.0 (2026-06-19) release: loops workflow hardening

## 0.2.0 (2026-06-19)

- feat: add workflows and account-routed execution

## 0.1.0 (2026-06-19)

- feat: build OpenLoops CLI daemon
