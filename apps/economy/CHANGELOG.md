# Changelog

## 0.4.0

### Minor Changes

- 00118b3: Resolve credentials through the `@hasna/contracts` 1.0.2 client chain (hasna/apps#1720).

  The CLI, the MCP server and the `./sdk` store surface no longer carry a
  credential chain of their own. All three route through the one resolver in
  `@hasna/contracts` (bumped from 0.13.4 to the exact 1.0.2), which reads, per
  call: an explicit `--api-key`/`--profile`, then `HASNA_ECONOMY_API_KEY_OVERRIDE`
  / `HASNA_PROFILE` / `HASNA_ECONOMY_API_KEY_REF`, then the macOS Keychain item
  `hasna.credentials.economy.api-key`, then `~/.hasna/economy/config/credentials`
  (0600, `HASNA_ECONOMY_API_KEY=…`), then `HASNA_ECONOMY_API_KEY`. The authority
  follows the same ladder — `HASNA_ECONOMY_API_URL`, the Keychain `api-url` item,
  the credentials file — and now DEFAULTS to the fleet gateway
  `https://api.hasna.com/economy` once a credential resolves, so a key alone is a
  complete configuration. A long-lived MCP server re-resolves the credential on
  every request, so a rotation heals without a restart.

  What this removes:

  - The app's own legacy env chain: the unprefixed serve token `ECONOMY_API_TOKEN`
    (canonical `HASNA_ECONOMY_API_TOKEN` remains) and `ECONOMY_MACHINE_ID`
    (canonical `HASNA_ECONOMY_MACHINE_ID`).
  - Retired `*_MODE` / `*_STORAGE_MODE` switches stay a hard error, and the
    DEPRECATED notice is gone: `HASNA_ECONOMY_API_KEY` is a legitimate resolver
    tier, it just sits below the Keychain and the credentials file.
  - Nothing reads `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` or
    `$XDG_CONFIG_HOME` — the resolver never consults those locations.

  What this keeps and adds:

  - Fail loud (owner directive 2026-09-04): hosted with no credential = non-zero
    exit, no SQLite file, no `economy-local-fallback` event, and an error naming
    every tier consulted. Local mode is served only by the explicit opt-in
    `HASNA_ECONOMY_LOCAL=1` (alias `ECONOMY_LOCAL=1` for one release), which
    yields to every hosted signal and now prints one `economy: local mode …` line
    on stderr.
  - `economy transport` (new CLI command): reports the resolved transport and the
    credential SOURCE — `/v1` authority, `api_url_source`, `api_key_source`,
    `api_key_tier` — never the key value; `--json` for the full report. It is the
    one surface that reports a refusal instead of throwing.
  - The `./sdk` store surface (`getStore`) is unchanged in shape, and it is the
    ONLY SDK: the Store takes no `baseUrl`, so the package can never attach an
    ambient fleet key to a caller-supplied one (hasna/apps#1794) — the authority
    and the credential both come from the resolver, per call.
  - `@hasna/contracts` stays a runtime dependency (economy builds with
    `--packages external`), so the published declarations importing its types
    resolve for consumers. The `/v1/machines` and `/v1/fleet` surfaces are
    unchanged and keep working against the resolved authority.

### Patch Changes

- 361d51b: Fail-closed / resolver validation fixes for the hosted-by-default client
  (hasna/apps#1720, validation round 1).

  - **MCP: no SQLite under the app home in hosted mode.** `economy-mcp` opened
    the agent-lifecycle registry (`agent-registry.db` plus its WAL/SHM sidecars)
    at startup — in hosted mode too, before any tool was called. The registry
    store is now resolved on first tool use, and a hosted client keeps it in
    memory for the life of the process; only the explicit `HASNA_ECONOMY_LOCAL=1`
    opt-in persists `agent-registry.db` beside the local store
    (`HASNA_AGENT_REGISTRY_DB_PATH` still names a file explicitly in either lane).
  - **MCP: the fail-closed diagnostic is the first stderr line**
    (`MCP server error: Economy fails closed …`, naming the Keychain item, the
    credentials file and `HASNA_ECONOMY_API_KEY`) instead of Bun's code frame.
  - **`economy transport` exits 1 when no credential resolves.** The report is
    still printed (`--json` included), so the diagnostic stays readable while a
    script can no longer take a refusal for a hosted transport.
  - **`economy-otel` follows the storage seam.** With a resolved credential the
    sidecar forwards the request/session rows of every accepted payload to the
    shared API's `/v1/ingest` (the response gains `forwarded`; nothing is written
    under `~/.hasna/economy`); under `HASNA_ECONOMY_LOCAL=1` it writes the
    on-box store and announces local mode on stderr; with neither it fails
    closed before binding. `economy-otel` stays undeclared in
    `hasna.contract.json` because `-otel` is outside the contract kit's bin
    allowlist.
  - **Hosted `economy sync` keeps its mtime cache as a JSON file under the cache
    root** (`HASNA_CACHE_HOME`, else `~/Library/Caches/Hasna/economy` on macOS /
    `~/.cache/hasna/economy` elsewhere; `HASNA_ECONOMY_INGEST_CACHE` overrides)
    instead of `~/.hasna/economy/ingest-cache.db`. An older cache file is simply
    not read — one re-read, absorbed by the server's idempotent upserts — and can
    be deleted.
  - **Manifest:** the CLI and MCP surfaces declare `authMode: api-key`
    (credential via the `@hasna/contracts` chain) and the SDK surface
    `exportSubpath: ./sdk`.
  - **No `-sdk` split package.** The unpublished in-tree `@hasna/economy-sdk`
    (`sdk/`) is removed: the SDK is the `./sdk` export of this one package — the
    Store abstraction, which takes no `baseUrl` and therefore never attaches an
    ambient fleet key to a caller-supplied one (hasna/apps#1794).
  - Test hygiene: `src/mcp/http.test.ts` restores the local opt-in it pins, so
    the #1788 ambient-gate test passes in the full suite; new spawned-bin tests
    cover the MCP hosted / fail-closed arms, the three `economy-otel` lanes and
    the `economy transport` exit codes.

## 0.3.28

### Patch Changes

- Switch @hasna/economy local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/economy` data root (with the `HASNA_ECONOMY_HOME` / `ECONOMY_HOME` exact-app overrides layered on top of the existing `HASNA_ECONOMY_DB_PATH` / `ECONOMY_DB` store override) stays the effective data root until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data root (and its `training` subdir) the runtime resolves. The OpenLoops ingest read (`economy sync --loops`) resolves the loops store through the resolver with a legacy-read fallback, so it keeps working whichever side of the XDG migration `@hasna/loops` is on. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.3.27

### Patch Changes

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0
  - @hasna/projects@1.0.0

## 0.3.26

### Patch Changes

- 8b70821: economy-otel answers --version/-V before any bind (todos row 7e5f8f3d). Previously `economy-otel --version` fell through to resolvePort()/Bun.serve and bound the OTLP listener (:4318) with no output.

## 0.3.25

### Patch Changes

- 2b87a81: Hermeticize six test suites (21a04472): economy ingest/sync tests stash the ambient Accounts API key, testers CLI/MCP tests stash the ambient Testers API env, attachments stash ambient API/todos keys and split the server harness out of the test file, shield routes CRUD modules through a db-access seam, hooks disable ambient core.hooksPath for fixture commits, markdown skips the per-package lockfile this monorepo layout does not have, and testers pins @hasna/browser to the published 0.5.29.

## 0.3.24

### Patch Changes

- @hasna/projects@1.0.0

## 0.3.23

### Patch Changes

- Updated dependencies [50473b8]
  - @hasna/projects@0.1.145

## 0.3.22

### Patch Changes

- @hasna/projects@0.1.144

## 0.3.21

### Patch Changes

- @hasna/projects@0.1.143

## 0.3.20

### Patch Changes

- @hasna/projects@0.1.142

## 0.3.19

### Patch Changes

- @hasna/projects@0.1.141

## 0.3.18

### Patch Changes

- @hasna/projects@0.1.140

## 0.3.17

### Patch Changes

- Updated dependencies [247187d]
  - @hasna/projects@0.1.139

## 0.3.16

### Patch Changes

- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4
  - @hasna/projects@0.1.138

## 0.3.15

### Patch Changes

- **Corrected release metadata.** This release is the first publish of the 0.3.13–0.3.15 wave. The dependency pins shipped here point at published versions: `@hasna/contracts` 0.13.3 with manifest `kitVersion` 0.13.3, and `@hasna/projects` 0.1.134 (the wave's original 0.1.137 pin was unpublished at release time and is not shipped). Internal-infra host literals were removed from shipped content (OpenAPI servers list, `economy init` help, storage-seam comment).
- c5232cc: fix: prepack typecheck resolves the optional @hasna/projects SDK as a runtime-only module (non-literal dynamic import), so the build no longer fails TS2307 against the unbuilt workspace member in a fresh checkout. Todos 029ceb00.
  - @hasna/projects@0.1.134

## 0.3.14

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run); the ship-latest wave then moved the pin to the published 0.13.3, and the manifest shipped here declares kitVersion 0.13.3 with the economy-otel bin. Todos d175d558.
  - @hasna/projects@0.1.136
  - @hasna/contracts@0.13.3

## 0.3.13

### Patch Changes

- 94f40c27: economy serve boots despite auth-contract refusal — the serve process no longer aborts at startup when the contracts auth seam refuses (missing or rejected API key); it stays up and reports the refusal (I38-00556).
- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2
  - @hasna/projects@0.1.135

## 0.3.12

### Patch Changes

- **Corrected release metadata.** The 0.3.11/0.3.12 wave entries previously recorded only dependency bumps. This release is the first publish from the hasna/apps monorepo and carries the functional delta since the last published 0.3.10; the entries below document it truthfully (the earlier "no functional changes" claim was written at import time and is superseded by the merged functional work).
- feat(economy): port provider/billing ingest to the hosted backend — no local-only sync (#414). In cloud-client mode (`HASNA_ECONOMY_API_URL` + key set), `economy sync` and the MCP sync tool now read on-box provider files and push them to the shared API's `/v1/ingest` instead of refusing with "cloud mode: ingest is a local-only operation"; billing sync (`economy billing sync`) likewise pushes provider billing rows to the hosted backend.
- chore(economy): display name "Hasna Economy" (open- prefix retired) (#311).
- chore(economy): conform `hasna.contract.json` to the contracts kit — seam, storage, surfaces (#485, #541), publish-guard/standard-gate reconciliation (#503), contracts CLI resolution without shims (#579).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.3.11

### Patch Changes

- 0df46e0: First release from the hasna/apps monorepo. The package was imported from hasna/economy with history preserved (import capsule 18b2aaf7d, import merge 7a3018a4f); the delta includes the import itself plus the monorepo workspace wiring, and the 0.3.12 entry above records the functional changes that landed after the import. This patch establishes version ownership under the monorepo.
- Updated dependencies [b630c48]
- Updated dependencies [139894d]
- Updated dependencies [0efd36e]
- Updated dependencies [5506f54]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16
  - @hasna/projects@0.1.134

All notable changes to this repository are tracked here. This project follows semantic versioning for published npm packages when practical.

## @hasna/economy 0.3.10 - 2026-08-15

Two PRs merged after `0.3.9`; neither is published yet.

- **#32** `fix(economy)` — `breakdown --since` now actually filters the billing
  window it reports, and `doctor` stops certifying drift between two zeroes: when
  no provider billing was imported, or the imported total is zero, drift is
  reported as UNKNOWN instead of a false `0.0%` green tick.
- **#33** `feat(contracts)` — satisfy the contracts `published_artifact_gate`:
  `prepack` builds into `dist` and runs `contracts artifact-scan dist`, so a
  packed tarball is scanned before it reaches the registry.

## @hasna/economy 0.3.9 - 2026-08-04

Release-only bump. Four PRs merged after `0.3.8` and were never published, because
this repo has no workflow that runs `npm publish` — the registry sat at `0.3.8`
while `main` accumulated a contracts migration, a data-correctness fix and a
metadata correction.

**Breaking for server operators.** `HASNA_ECONOMY_STORAGE_MODE` (and the
`ECONOMY_STORAGE_MODE` alias) are retired for server backend selection. They are
now _rejected at startup with a migration hint_ rather than normalized, so a
half-migrated deployment fails loudly instead of quietly serving the wrong store.
The server data backend is `sqlite | postgresql`, selected by the presence of
`HASNA_ECONOMY_DATABASE_URL` alone. If you set `HASNA_ECONOMY_STORAGE_MODE=cloud`
to reach Postgres, unset it and rely on the database URL.

- **#27** `fix(client)` — hard-fail a half-applied cloud flip instead of silently
  serving local data. An `API_URL` set _without_ an `API_KEY` previously resolved
  to `local` with no warning, byte-identical to an unconfigured host: the CLI
  served the local SQLite store while the operator had pointed it at the cloud
  API — a different dataset rendered as plausible spend numbers. It now reports
  `misconfigured` and refuses. An unconfigured machine (neither variable set)
  stays silently local; that negative control is covered by a test.
- **#28** `fix(contracts)` — migrate `storage.mode` to `storage.backend` for
  contract kit `0.9.0`; declare `hosting` and `serviceSurfaces` in
  `hasna.contract.json`. Bumps `@hasna/contracts` `^0.4.2` -> `^0.9.0`.
- **#29** `fix(server)` — make the runtime speak the `0.9.0` backend vocabulary it
  declares; `isCloudMode()` is replaced by `resolveEconomyServerBackend()` and
  `isPostgresBackend()` (both internal — neither was ever exported from the
  package root).
- **#30** `fix(package)` — describe Gemini CLI support as legacy rather than
  active, and name the Gemini API billing ingest separately. Google retired the
  Gemini CLI on 2026-06-18.

## @hasna/economy 0.3.7 - 2026-07-24

Reconciliation release: `main` had diverged from the published npm line. The `0.3.x`
code (`0.3.0`-`0.3.6`, the unified `Store` refactor plus the cloud/self_hosted service
surfaces) shipped to npm from `feature`-line commits and was never merged back, while
`main` (`0.2.52`) carried two merged-but-unpublished features. This release is a real
three-way merge that keeps **both** histories.

- Merged the published `v0.3.6` tag (`4f76834`) into `main`, preserving both parents.
- Forward-ported **compact CLI/MCP output defaults** (#4) onto the `Store` surfaces:
  `--limit`/`--verbose`/`--json` on `breakdown`, `budget list`, `project list`,
  `pricing list`, `goal list`, `goal status`, `usage`, `subscriptions list`, `fleet`;
  `limit`/`verbose`/`json` params on the `get_model_breakdown`, `get_project_breakdown`,
  `get_account_breakdown`, `get_budget_status`, `get_pricing`, `get_goals`,
  `list_machines`, `get_session_detail`, `get_usage`, `get_savings`, `sync` and
  `set_subscription` MCP tools.
- Forward-ported **token cost centers** (#5) onto the `Store` architecture: added
  `EconomyStore.costCenterBreakdown()` (local SQLite + cloud `/v1` transports),
  `cost_center_id` on `BudgetInput`, and the `breakdown --by cost-center|loop|app|repo`
  CLI dimension plus the `get_cost_center_breakdown` MCP tool. The cloud transport
  drops rows the API did not attribute to a cost center, so an un-upgraded serve
  reports "no cost-center usage" instead of mislabelling model rows.
- Dropped the main-only code the `0.3.x` refactor deliberately removed as the
  forbidden DSN-on-client pattern: `src/lib/peer-sync.ts`, `src/lib/cloud-sync.ts`
  (and with it the `cloud schedule install|status|remove` commands) and
  `src/lib/fleet-sync.ts`. The MCP `sync` tool no longer reports `cloud_pushed` /
  `cloud_pulled` because `SyncAllResult` no longer carries them.
- Bumped strictly above the published `0.3.6` latest. (The `v0.3.6` tag commit itself
  carried `package.json` version `0.3.5`; the `0.3.6` publish bumped the registry
  without a follow-up commit.)

## @hasna/economy 0.2.43 - 2026-07-06

- Added the self_hosted service surface: `economy-serve` foundation probes (`GET /health`, `/ready`, `/version` -> `{ status, version, mode }`) and a versioned `/v1` API covering summaries, sessions, breakdowns, budgets, goals, pricing, subscriptions, billing, and sync.
- Added API-key authentication for the internet-facing `/v1` surface via `@hasna/contracts/auth` (stateless HMAC verify + revocation check).
- Added Amendment A1 PURE-REMOTE cloud storage: the serve reads/writes the shared RDS Postgres directly through a worker-backed synchronous PG adapter (no local cache, no sync engine in the service).
- Added a typed SDK client generated from the serve OpenAPI (`ECONOMY_API_URL` + `ECONOMY_API_KEY`).
- Added the deploy surface: ARM64/bun `Dockerfile`, `docker-compose.yml`, `hasna.contract.json`, a `migrations/` directory + runner (`economy-serve migrate`).

## @hasna/economy 0.2.41 - 2026-06-24

- Added root open-source project files for release notes, security reporting, contributing guidance, and conduct expectations.
- Added npm repository, issue tracker, and homepage metadata.
- Added package file allow-list coverage for release notes and security metadata.
- Ignored local `.takumi/` SQLite state so private local telemetry is not accidentally staged.

## @hasna/economy-sdk 0.2.1 - 2026-06-24

- Added npm repository, issue tracker, and homepage metadata.
- Added a package README and full Apache-2.0 license file to the SDK tarball.

## @hasna/economy 0.2.40 - 2026-06-24

- Added `economy brief` with text and JSON fleet summaries for tokens, cache reads/writes, cost, machine rows, agent rows, account rows, and freshness.
- Added Codewith state-store ingestion from `~/.codewith/state_5.sqlite` alongside legacy Codex ingestion, with distinct session IDs and ingest cursors.
- Added macOS machine identity fallback so apple hosts report stable machine IDs instead of generic `mac` hostnames.
- Added brief pre-read sync and SQL aggregation changes to keep the command responsive on large merged fleet databases.
- Added pricing coverage for current Claude Opus and Codewith GPT-5.5 model identifiers.
- Hardened billing, database, and Codex ingest tests used in the release verification flow.
- Published and fleet-installed `@hasna/economy@0.2.40`; the release was verified on spark01, spark02, and apple03 after correcting an apple03 Bun-global shim drift.

## @hasna/economy-sdk 0.2.0 - 2026-06-24

- Current published SDK package for the Economy REST API client.
- Release metadata now points to the public Hasna Economy repository and Apache-2.0 license.
