# Shared Kit Extraction Inventory

Date: 2026-07-07

Task: `8fd378e0-909c-4d13-8c7d-16b950591c2f`

This is a report-only inventory for the P5 shared-kits workstream. It does not
publish packages, edit Bun release-age exclusions, migrate consumers, or change
runtime code.

Current-status correction (2026-07-20): the cross-repo observations below
remain the 2026-07-07 inventory. Loops state normalization landed through
PR #81 at commit `0acb5e79` and merge commit `6d1e9536`. The current strict
storage kit is version `0.5.2`, established through PR #93 at commit
`1456b852`, and its validation command is `bun run check:contracts`. PR #84 is
not current normalization evidence and has its own disposition.

## Summary

The strongest extraction candidate is the generated Hasna storage kit. It is
already a bounded kit, it is stamped into multiple repositories by
`@hasna/contracts vendor-kit`, and the inspected repos show repeated hashes
across version cohorts. It should be normalized and extracted before less
stable runtime, CLI, event, or logging helpers.

The CLI, local path/config, logging/redaction, retention, and event surfaces are
real duplication, but they are not equally ready. Some already have an owning
package (`@hasna/events`, `@hasna/logs`, `@hasna/contracts`). Others have
repo-specific behavior that would make a broad extraction risky without a
human package-boundary decision.

Recommended first automation slice:

1. Treat Loops normalization as complete: version `0.5.1` state
   normalization landed through PR #81 at commit `0acb5e79` and merge commit
   `6d1e9536`; the current strict storage kit is version `0.5.2`, established
   through PR #93 at commit `1456b852`. Validate it with
   `bun run check:contracts`.
2. After human approval of package ownership/name, extract the generated kit
   into a shared package or stable `@hasna/contracts` subpath.
3. Migrate consumers one repo cohort at a time, preserving their local storage
   semantics.

## Repos And Files Inspected

Primary repo, writeable worktree:

- `open-loops/package.json`
- `open-loops/docs/AUTOMATION_RUNTIME_DESIGN.md`
- `open-loops/docs/DEPLOYMENT_MODES.md`
- `open-loops/docs/RUNTIME_BOUNDARY.md`
- `open-loops/docs/USAGE.md`
- `open-loops/src/cli/index.ts`
- `open-loops/src/api/index.ts`
- `open-loops/src/serve/index.ts`
- `open-loops/src/runner/index.ts`
- `open-loops/src/daemon/index.ts`
- `open-loops/src/daemon/daemon.ts`
- `open-loops/src/daemon/install.ts`
- `open-loops/src/lib/mode.ts`
- `open-loops/src/lib/paths.ts`
- `open-loops/src/lib/env.ts`
- `open-loops/src/lib/storage/contract.ts`
- `open-loops/src/lib/storage/sqlite.ts`
- `open-loops/src/lib/storage/postgres.ts`
- `open-loops/src/lib/storage/postgres-schema.ts`
- `open-loops/src/lib/hygiene.ts`
- `open-loops/src/lib/run-artifacts.ts`
- `open-loops/src/lib/run-receipts.ts`
- `open-loops/src/lib/cloud/mode.ts`
- `open-loops/src/lib/cloud/resolve.ts`
- `open-loops/src/lib/cloud/storage.ts`
- `open-loops/src/lib/cloud/transport.ts`
- `open-loops/src/lib/route/options.ts`
- `open-loops/src/lib/route/route-event.ts`
- `open-loops/src/lib/route/todos-cli.ts`
- `open-loops/src/sdk/index.ts`
- `open-loops/src/generated/storage-kit/*`

Sibling repos inspected read-only:

- `open-todos/package.json`
- `open-todos/src/cli/index.tsx`
- `open-todos/src/cli/helpers.ts`
- `open-todos/src/cli/cloud-router.ts`
- `open-todos/src/db/database.ts`
- `open-todos/src/db/webhooks.ts`
- `open-todos/src/lib/event-hooks.ts`
- `open-todos/src/lib/shared-events.ts`
- `open-todos/src/lib/retention-cleanup.ts`
- `open-todos/src/storage/config.ts`
- `open-projects/package.json`
- `open-projects/src/cli/index.ts`
- `open-projects/src/cli/commands/storage.ts`
- `open-projects/src/db/database.ts`
- `open-projects/src/db/remote-storage.ts`
- `open-projects/src/db/storage-sync.ts`
- `open-projects/src/lib/project-store-paths.ts`
- `open-projects/src/generated/storage-kit/*`
- `open-conversations/package.json`
- `open-conversations/src/cli/index.tsx`
- `open-conversations/src/lib/cloud-store.ts`
- `open-conversations/src/lib/db.ts`
- `open-conversations/src/lib/webhooks.ts`
- `open-conversations/src/generated/storage-kit/*`
- `open-mementos/package.json`
- `open-mementos/src/cli/index.tsx`
- `open-mementos/src/db/database.ts`
- `open-mementos/src/lib/config.ts`
- `open-mementos/src/generated/storage-kit/*`
- `open-knowledge/package.json`
- `open-knowledge/src/cli.ts`
- `open-knowledge/src/cloud-store.ts`
- `open-knowledge/src/knowledge-db.ts`
- `open-knowledge/src/db/remote-storage.ts`
- `open-knowledge/src/generated/storage-kit/*`
- `open-machines/package.json`
- `open-machines/src/cli/index.ts`
- `open-machines/src/paths.ts`
- `open-machines/src/cloud/mode.ts`
- `open-machines/src/cloud/storage.ts`
- `open-machines/src/remote-storage.ts`
- `open-machines/src/generated/storage-kit/*`
- `open-accounts/package.json`
- `open-accounts/src/cli.ts`
- `open-accounts/src/lib/env.ts`
- `open-accounts/src/lib/events.ts`
- `open-accounts/src/storage.ts`
- `open-accounts/src/generated/storage-kit/*`
- `open-configs/package.json`
- `open-configs/src/cli/index.tsx`
- `open-configs/src/cli/storage.ts`
- `open-configs/src/lib/session-render.ts`
- `open-configs/src/storage.ts`
- `open-configs/src/generated/storage-kit/*`
- `open-logs/package.json`
- `open-logs/src/cli/index.ts`
- `open-logs/src/db/index.ts`
- `open-logs/src/lib/cloud-store.ts`
- `open-logs/src/lib/event-store.ts`
- `open-logs/src/lib/redaction.ts`
- `open-logs/src/lib/retention.ts`
- `open-logs/src/lib/rotate.ts`
- `open-logs/src/generated/storage-kit/*`
- `open-events/package.json`
- `open-events/src/cli/index.ts`
- `open-events/src/commander.ts`
- `open-events/src/index.ts`
- `open-events/src/storage.ts`
- `open-events/src/transports.ts`
- `open-codewith/package.json`
- `open-codewith/scripts/start-codewith-exec.sh`
- `open-codewith/scripts/run_tui_with_exec_server.sh`
- `open-codewith/scripts/test-remote-env.sh`
- `open-codewith/scripts/install/install.sh`
- `open-codewith/scripts/mock_responses_websocket_server.py`

## Concrete Duplication Evidence

### Generated Storage Kit

`src/generated/storage-kit/README.md` describes this as a generated fleet
storage kit from `@hasna/contracts vendor-kit`, with mode resolution, TLS,
pool, query, migrations, health, and no sync/cache behavior. The inspected
repos carry the same generated file set:

- `index.ts`
- `mode.ts`
- `pool.ts`
- `query.ts`
- `tls.ts`
- `health.ts`
- `migrations.ts`
- `.storage-kit-manifest.json`
- `README.md`

Observed manifest cohorts:

- `kitVersion: 0.4.0`: `open-loops`, `open-knowledge`
- `kitVersion: 0.4.1`: `open-projects`, `open-conversations`,
  `open-mementos`, `open-accounts`
- `kitVersion: 0.4.2`: `open-machines`, `open-configs`, `open-logs`

Observed hash evidence:

- `open-projects`, `open-conversations`, `open-mementos`, and
  `open-accounts` have identical hashes for all sampled generated storage kit
  files at `kitVersion: 0.4.1`.
- `open-machines`, `open-configs`, and `open-logs` have identical hashes for
  all sampled generated storage kit files at `kitVersion: 0.4.2`.
- `open-loops` and `open-knowledge` share the same `index.ts`, `mode.ts`,
  `pool.ts`, `query.ts`, and `health.ts` hashes at `kitVersion: 0.4.0`; their
  `tls.ts` and `migrations.ts` hashes differ from each other, so they need a
  drift check before extraction.
- All inspected generated storage-kit `README.md` files use the same hash.

This is the best candidate because it is already generated, bounded, and
versioned. Extraction would reduce vendored drift and stop each repo from
carrying generated code in source.

### Local Storage And Path Resolution

The repos also duplicate local data directory and database path logic:

- `open-loops/src/lib/paths.ts` resolves `LOOPS_DATA_DIR` or
  `~/.hasna/loops`, then derives `loops.db`, daemon PID/log paths, and startup
  service paths.
- `open-todos/src/db/database.ts` resolves `HASNA_TODOS_DB_PATH`, nearest
  `.hasna/todos/todos.db`, git-root `.hasna/todos/todos.db`, and finally
  `~/.hasna/todos/todos.db`.
- `open-projects/src/db/database.ts` resolves `HASNA_PROJECTS_DB_PATH`, legacy
  `HASNA_WORKSPACES_DB_PATH`, and `~/.hasna/projects/projects.db`, then enables
  WAL and foreign keys.
- `open-projects/src/lib/project-store-paths.ts` resolves
  `HASNA_PROJECTS_HOME` plus per-workspace `workspaces/<id>` and `data/<id>`
  paths.
- `open-conversations/src/lib/db.ts` resolves `~/.hasna/conversations`,
  migrates from `~/.conversations`, and honors `HASNA_CONVERSATIONS_DB_PATH`
  and `CONVERSATIONS_DB_PATH`.
- `open-logs/src/db/index.ts` resolves `HASNA_LOGS_DATA_DIR` or
  `LOGS_DATA_DIR`, migrates from `~/.logs`, enforces `0700`/`0600`, and enables
  WAL/foreign keys with busy retries.
- `open-events/src/storage.ts` resolves `HASNA_EVENTS_DIR`,
  `HASNA_EVENTS_HOME`, or `~/.hasna/events`, then creates the directory with
  private mode.

There is duplication, but local path behavior differs enough by app that it
should be a small helper inside a broader storage/runtime kit, not a standalone
package first.

### Cloud Client And Storage Sync

The generated storage kit deliberately excludes sync/cache logic, but several
repos re-implement adjacent cloud transport or remote storage wrappers:

- `open-loops/src/lib/cloud/transport.ts` resolves client mode and cloud HTTP
  transport from `HASNA_<APP>_STORAGE_MODE`, API URL, and API key variables.
- `open-conversations/src/lib/cloud-store.ts` uses
  `@hasna/contracts/client/storage` and adds app-specific implied
  `self_hosted` mode when API URL and API key are present.
- `open-logs/src/lib/cloud-store.ts` follows the same implied self-hosted
  pattern and wraps a cloud store for logs resources.
- `open-projects/src/db/remote-storage.ts` implements a local `PgAdapterAsync`
  with placeholder translation, undefined-to-null conversion, and TLS
  detection.
- `open-projects/src/db/storage-sync.ts`, `open-logs/src/lib/storage-sync.ts`,
  and equivalent storage exports expose similar status, push, pull, sync,
  canonical RDS, and table-selection concepts.

This is a second-order candidate after the generated storage kit. A premature
sync extraction would mix very different app data models.

### CLI Scaffolding

The inspected repos duplicate Commander setup, JSON detection, package-version
lookup, printing helpers, and numeric option parsing:

- `open-loops/src/cli/index.ts` has `new Command()`, global `-j/--json`,
  `print`, `reportCliError`, `runAction`, deployment status printing, and many
  repeated option parser helpers.
- `open-todos/src/cli/index.tsx` has a top-level Commander app, global
  `--project`, `--json`, `--agent`, and `--session`, dynamic command module
  registration, and optional event command fallback logic.
- `open-todos/src/cli/helpers.ts` has `printJson`; many todo command modules
  also define local parse helpers.
- `open-projects/src/cli/index.ts` duplicates package-version lookup,
  Commander setup, JSON env toggles, and prompt-mode argument routing.
- `open-projects/src/cli/commands/storage.ts`,
  `open-configs/src/cli/storage.ts`, and `open-machines/src/cli/index.ts`
  duplicate storage command shapes and JSON printing.
- `open-events/src/cli/index.ts` is a hand-rolled parser rather than Commander,
  while `open-events/src/commander.ts` provides a reusable Commander
  registration helper for events/channels.

This is a real candidate, but not first. The repos differ between Ink CLIs,
plain Commander CLIs, hand-rolled CLIs, prompt-mode CLIs, and safety-gated
mutation CLIs. A package boundary needs human approval and a compatibility
matrix before migration.

### Event And Webhook Functionality

`@hasna/events` already exists and is partially adopted:

- `open-events/src/index.ts`, `src/transports.ts`, `src/storage.ts`, and
  `src/commander.ts` define the shared EventsClient, storage, transports, and
  Commander registration helper.
- `open-projects/src/cli/index.ts`,
  `open-conversations/src/cli/index.tsx`, `open-accounts/src/cli.ts`, and
  `open-configs/src/cli/index.tsx` call `registerEventsCommands`.
- `open-todos/src/lib/shared-events.ts` uses `EventsClient`, but
  `open-todos/src/lib/event-hooks.ts` and `open-todos/src/db/webhooks.ts`
  still retain local event-hook and webhook implementations.
- `open-conversations/src/lib/webhooks.ts` keeps config-backed app-specific
  webhook dispatch.
- `open-machines/src/cli/index.ts`, `src/commands/runtime.ts`,
  `src/commands/serve.ts`, and `src/mcp/server.ts` directly use
  `EventsClient` while preserving machine-specific mutation approval gates.
- `open-loops/src/lib/route/route-event.ts` imports `EventEnvelope` and owns
  route-specific event-to-workflow behavior; `open-loops/src/cli/index.ts`
  exposes deprecated `events` aliases for route commands, not generic events.

The correct package proposal is not a new event kit. It is continued adoption
of `@hasna/events` plus explicit compatibility tasks for app-local webhook
features.

### Logging, Redaction, Retention, And Evidence

There are overlapping diagnostics patterns:

- `open-loops/src/daemon/daemon.ts` implements `daemonLogLine`,
  `rotateDaemonLog`, default daemon stderr logging, and daemon lease/run logs.
- `open-loops/src/lib/run-artifacts.ts` writes workflow run manifests under
  `runs/<project>/<subject>/<workflowRunId>/manifest.json` with staged temp
  promotion.
- `open-loops/src/lib/run-receipts.ts` normalizes receipts, canonical JSON
  digests, bounded stdout/stderr excerpts, evidence paths, and task/knowledge
  IDs.
- `open-todos/src/lib/retention-cleanup.ts` owns local cleanup reports for old
  comments, runs, verification evidence, and expired artifact files.
- `open-logs/src/lib/redaction.ts` owns richer log-entry redaction for tokens,
  URL userinfo, secret assignments, auth flags, query params, emails, and more.
- `open-logs/src/lib/retention.ts` and `src/lib/rotate.ts` implement per-level
  TTL and max-row log deletion.
- `open-codewith/scripts/start-codewith-exec.sh`,
  `scripts/run_tui_with_exec_server.sh`, and `scripts/test-remote-env.sh`
  provide shell cleanup/trap patterns; `scripts/mock_responses_websocket_server.py`
  provides mock event streaming helpers. These were inspected as bounded
  script surfaces, but they do not justify a shared Hasna TypeScript kit by
  themselves.

This area is security-sensitive and overlaps with the existing `@hasna/logs`
package. Do not create a separate logging package without deciding whether
`@hasna/logs` owns redaction/rotation APIs for the fleet.

## Candidate Package Boundaries

### 1. `@hasna/storage-kit`

Status: highest-confidence candidate; package publish/name needs human
approval. Loops normalization is complete: version `0.5.1` state
normalization landed through PR #81 at commit `0acb5e79` and merge commit
`6d1e9536`, and the current strict storage kit is version `0.5.2`, established
through PR #93 at commit `1456b852`. PR #84 is not current normalization
evidence and has its own disposition.

Responsibilities:

- Storage mode/env resolution for local vs cloud/self-hosted semantics.
- Postgres TLS handling that matches libpq `sslmode`.
- `pg.Pool` factory and typed query helpers.
- Migration ledger and checksum validation.
- Health and readiness probes.
- Optional app path helper for `~/.hasna/<app>/<app>.db` and app-specific env
  key sets, once local path semantics are normalized.

Non-responsibilities:

- App schema definitions.
- App-specific local SQLite migrations.
- Bidirectional sync engines.
- HTTP API resource mapping.
- Runtime auth decisions.
- Release-age exclusion edits.

Migration order:

1. Keep `open-loops/src/generated/storage-kit` on the current strict
   `@hasna/contracts` version `0.5.2` and verify it with
   `bun run check:contracts`. The earlier version `0.5.1` state normalization
   landed through PR #81 at commit `0acb5e79` and merge commit `6d1e9536`; PR
   #93 commit `1456b852` established the current strict version.
2. Human approval: decide whether the importable boundary is a new
   `@hasna/storage-kit` package or an `@hasna/contracts/storage-kit` subpath.
3. Move generator source into the approved package boundary and add package
   metadata only after approval.
4. Migrate one consumer cohort at a time:
   `open-loops` plus `open-knowledge` (`0.4.0` cohort),
   `open-projects`/`open-conversations`/`open-mementos`/`open-accounts`
   (`0.4.1` cohort), then
   `open-machines`/`open-configs`/`open-logs` (`0.4.2` cohort).
5. Remove vendored generated files only after imports, type declarations, and
   package pack contents are stable.

Validation:

- For the current Loops checkout: `bun run check:contracts`.
- Per consumer: `bun run typecheck`, targeted storage tests, and package
  boundary/no-cloud tests where present.
- For Loops: `bun run typecheck`, `bun test src/lib/storage/*.test.ts`,
  `bun run test:boundary`, and `bun run check:contracts`.

Blockers:

- Human approval for package name and ownership.
- Publish step and Bun release-age exclusion updates are out of scope until
  approval.
- Consumers currently depend on different kit versions; extraction must handle
  version skew explicitly.

### 2. `@hasna/app-runtime`

Status: medium-confidence candidate; not ready for immediate extraction.

Responsibilities:

- Resolve app home/data directories from `HASNA_<APP>_...` env keys.
- Create private directories and DB files with consistent permissions.
- Provide legacy-dotdir migration helpers.
- Normalize package-version lookup.
- Normalize executable PATH helpers for Bun/Node CLIs.

Evidence:

- `open-loops/src/lib/paths.ts`
- `open-loops/src/lib/env.ts`
- `open-todos/src/db/database.ts`
- `open-projects/src/db/database.ts`
- `open-projects/src/lib/project-store-paths.ts`
- `open-conversations/src/lib/db.ts`
- `open-logs/src/db/index.ts`
- `open-events/src/storage.ts`

Blockers:

- App semantics differ: project-local DBs, global DBs, legacy migration,
  private permissions, launchd/systemd paths, and per-workspace stores are not
  uniform.
- Should probably be a module inside the storage-kit boundary instead of a
  separate package at first.

### 3. `@hasna/cli-kit`

Status: useful but requires human approval and a compatibility matrix.

Responsibilities:

- Commander registration helpers for global JSON, version, error envelopes,
  option parsing, and consistent text/JSON output.
- Optional command module registration pattern.
- Shared storage command scaffolding where the underlying storage API matches.
- Shared validation helpers for positive integers, durations, and list flags.

Evidence:

- `open-loops/src/cli/index.ts`
- `open-todos/src/cli/index.tsx`
- `open-todos/src/cli/helpers.ts`
- `open-projects/src/cli/index.ts`
- `open-projects/src/cli/commands/storage.ts`
- `open-configs/src/cli/storage.ts`
- `open-machines/src/cli/index.ts`
- `open-events/src/commander.ts`

Blockers:

- CLI UX differs materially across apps.
- Some repos use Ink and React, some use plain Commander, and `open-events`
  has both hand-rolled and Commander embedding surfaces.
- Extracting too early could create a heavy dependency for simple binaries.

### 4. Existing `@hasna/events` Adoption Kit

Status: no new package needed. Adoption tasks are partially automation-ready,
but each repo needs a compatibility check.

Responsibilities already owned by `@hasna/events`:

- Event envelopes.
- Local event/channel storage.
- Delivery transports.
- Filters and replay.
- Commander command registration through `@hasna/events/commander`.

Migration order:

1. Document app-local event features that `@hasna/events` does not cover yet.
2. Preserve `open-loops` route-event behavior separately; it is workflow route
   admission, not generic event recording.
3. Migrate local webhook implementations only where `@hasna/events` can
   preserve filtering, approval gates, and nonblocking dispatch behavior.
4. Retire compatibility aliases only with explicit deprecation docs/tests.

Blockers:

- `open-todos` and `open-conversations` have local webhook/event-hook behavior
  that may not map 1:1 to `@hasna/events`.
- `open-machines` has mutation approval gates around shared event webhooks.
- `open-loops` currently uses `events` aliases for route operations, so a
  generic events command group could conflict with existing operator workflows.

### 5. Existing `@hasna/logs` Or `@hasna/diagnostics-kit`

Status: approval-gated and security-sensitive.

Responsibilities to consider:

- Structured log line helpers.
- Log rotation.
- Redaction primitives.
- Bounded output/excerpt helpers.
- Retention report formats.

Evidence:

- `open-loops/src/daemon/daemon.ts`
- `open-loops/src/lib/run-receipts.ts`
- `open-todos/src/lib/retention-cleanup.ts`
- `open-logs/src/lib/redaction.ts`
- `open-logs/src/lib/retention.ts`
- `open-logs/src/lib/rotate.ts`

Blockers:

- `@hasna/logs` already exists and likely owns much of this domain.
- Redaction changes require security review and regression fixtures.
- Log retention is app-specific and should not be centralized until schemas are
  aligned.

## Automation Readiness

Ready for automation now:

- Loops generated storage-kit normalization is complete. Version `0.5.1`
  state normalization landed through PR #81 at commit `0acb5e79` and merge
  commit `6d1e9536`; PR #93 commit `1456b852` established the current strict
  version `0.5.2`. PR #84 is not current normalization evidence and has its own
  disposition. Do not auto-route a duplicate normalization task.

Ready after human approval:

- Create an importable storage-kit package/subpath.
- Migrate consumers from vendored generated storage-kit files to imports.
- Extract a CLI helper package.
- Define any new `@hasna/*` package name and publish plan.

Not ready yet:

- Logging/redaction centralization.
- Retention cleanup centralization.
- Loops route-event migration.
- Broad local path/runtime extraction.

## Follow-Up Todo Plan

Created follow-up task:

1. Loops storage-kit normalization.
   Task: `2b166a36-1e7c-4882-be7f-610c4f478d39`
   Fingerprint: `open-loops:p5:shared-kit:storage-kit:open-loops-normalize`
   Dependency: this inventory task.
   Historical output: PR #84 (`https://github.com/hasna/loops/pull/84`).
   Current status: version `0.5.1` state normalization landed through PR #81
   at commit `0acb5e79` and merge commit `6d1e9536`; PR #93 commit `1456b852`
   established the current strict version `0.5.2`. PR #84 is not current
   normalization evidence and has its own disposition.

Recommended follow-up tasks that were not created in this worker step:

2. Storage-kit package approval checkpoint.
   Fingerprint: `open-loops:p5:shared-kit:storage-kit:approval`
   Dependency: storage-kit normalization evidence.
   Status: human approval required; do not auto-route until approved.

3. Events compatibility inventory for Loops route aliases.
   Fingerprint: `open-loops:p5:shared-kit:events:open-loops-compat`
   Dependency: this inventory task and current `@hasna/events` behavior.
   Status: automation-ready as a report/test inventory only; implementation
   should wait until alias compatibility is proven.

4. CLI-kit compatibility matrix.
   Fingerprint: `open-loops:p5:shared-kit:cli-kit:matrix`
   Dependency: storage-kit normalization is not required, but human approval is
   needed before package creation.
   Status: report-only unless approved.

The first item has already run and must not be auto-routed again. The other
items remain documented until package ownership or compatibility decisions are
made.

## Validation Requirements For Later Implementation

For any follow-up that changes package metadata:

- `git diff --check`
- `bun install --frozen-lockfile` only when lockfile changes require it
- `bun run typecheck`
- `bun test`
- `bun run test:boundary` where present
- `bun pm pack --dry-run` before publishable package changes
- Staged secrets scan before commit

For storage-kit consumer migrations:

- Verify generated-kit or import boundary check.
- Run per-repo storage tests.
- Run any local/cloud/no-cloud boundary tests.
- Validate package export maps and declaration files.
- Do not remove vendored files until import paths work from a packed package or
  approved workspace dependency.

For event adoption:

- Verify CLI help and JSON output for `events`/`channels` commands.
- Preserve local webhook filtering, nonblocking behavior, and approval gates.
- Add regression tests for legacy aliases before retiring them.

For logging/redaction:

- Add canary tests for tokens, URL userinfo, auth headers, query params, and
  secret-looking assignment strings.
- Confirm no raw secrets appear in task comments, logs, receipts, event
  envelopes, or API responses.

## Human Approval And Publishing Blockers

- New package names require approval before package metadata, npm publish, or
  Bun release-age exclusion edits.
- `@hasna/storage-kit` vs `@hasna/contracts/storage-kit` is an ownership
  decision.
- `@hasna/cli-kit` must not centralize repo-specific prompt-mode or Ink UI
  behavior without a compatibility matrix.
- `@hasna/logs` ownership must be resolved before creating diagnostics or
  redaction packages.
- No consumer migration should be routed until the package boundary and package
  source of truth are approved.
