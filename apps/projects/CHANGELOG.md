# Changelog

## 1.1.0

### Minor Changes

- 9c616c0: Resolve credentials through the `@hasna/contracts` client resolver
  (hasna/apps#1720, #1668, #1690, #1613, #1599).

  - `@hasna/contracts` is pinned to `1.0.1`, and the vendored server storage kit
    is regenerated at that version.
  - The CLI, the MCP server and the `./sdk` export now share ONE credential and
    authority resolution — the contracts client seam — recomputed on every call.
    Precedence: an explicit argument → a deliberate env pointer
    (`HASNA_PROJECTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
    `HASNA_PROJECTS_API_KEY_REF`) → the macOS Keychain item
    `hasna.credentials.projects.api-key` (account `HASNA_STATION`, else
    `hostname -s`, else `USER`) → `~/.hasna/projects/config/credentials`
    (0400/0600, read at call time, `HASNA_HOME`/`HASNA_CONFIG_HOME` overrides,
    XDG never) → `HASNA_PROJECTS_API_KEY` in the process environment, which is a
    legitimate tier and prints no notice.
  - The service URL follows the same ladder (`HASNA_PROJECTS_API_URL`, the
    Keychain `api-url` item, the credentials file) and defaults to the
    path-prefixed fleet gateway `https://api.hasna.com/projects`; the client
    appends `/v1`. A key alone is now enough to reach the fleet — URLs never need
    configuring.
  - `createProjectsClientFromEnv()` no longer reads `PROJECTS_API_URL` /
    `PROJECTS_API_KEY` itself. Those unprefixed names remain accepted by the seam
    as a documented alias for one release; the canonical `HASNA_PROJECTS_*` names
    always work and win. The SDK completes a `HASNA_PROJECTS_API_KEY_REF` vault
    pointer per request, and throws instead of building an unauthenticated client.
  - **Breaking for local runs:** `HASNA_PROJECTS_LOCAL_REGISTRY` is removed.
    Routing is on URL + key only. An authority declared anywhere with no
    resolvable credential fails LOUD (non-zero exit, no local SQLite store opened,
    no local-fallback event); the on-box registry is reached only when NOTHING
    configures the fleet, and that unhosted OSS mode prints one line on stderr
    saying so and naming the database it opened.
  - `projects-serve`'s Contacts authority uses the same rule: a completely silent
    environment yields no authority, anything half-configured throws. Server-side
    API-key verification is unchanged.

### Patch Changes

- af6f823: Project registration authorities reach a path-prefixed gateway base URL
  (hasna/apps#1601).

  `HASNA_TODOS_API_URL` / `HASNA_MEMENTOS_API_URL` / `HASNA_CONVERSATIONS_API_URL`
  were normalized with `new URL(raw).origin`, which silently dropped the
  `/<app>` segment of the gateway form `https://api.hasna.com/<app>` and made the
  authority unreachable; a base carrying any path other than `/v1` was rejected
  outright. The path prefix is now kept, a trailing `/v1` is folded off exactly
  once (the shipped clients add their own `/v1` route prefix), and bases carrying
  userinfo, a query or a fragment are still refused.

## 1.0.4

### Patch Changes

- Switch @hasna/projects local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout): the projects home (`getProjectsHome`) and the default registry DB path (`getDbPath`, derived from the home) now resolve through `dataDir({ app: "projects" })`. The legacy `~/.hasna/projects` home (with the `HASNA_PROJECTS_HOME` / `HASNA_PROJECTS_DB_PATH` / `HASNA_WORKSPACES_DB_PATH` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home (`projects.db` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.2` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 1.0.3

### Patch Changes

## 1.0.2

### Patch Changes

- Updated dependencies [c4622d9]
  - @hasna/contracts@0.14.0
  - @hasna/conversations@0.7.7

## 1.0.1

### Patch Changes

- 6631454: Remove the deployment-mode surface (2026-07-29 doctrine): client transport is selected by API URL + API key presence only; URL-only or key-only configuration fails closed instead of silently falling back to local sqlite; legacy `*_STORAGE_MODE` / `*_MODE` selectors are inert; `/version` and root server responses no longer carry a mode field; `ProjectStore.mode` renamed to `transport` (`local | http`); README and docs scrubbed of banned mode vocabulary. Resource-link operation modes (`add | reconcile`) are preserved.

## 1.0.0

### Patch Changes

- Updated dependencies [4ee7aed]
  - @hasna/loops@0.6.0

## 0.1.145

### Patch Changes

- 50473b8: fix: main CI recovery — regenerate per-app lockfiles after the #856/#923 version waves (frozen-lockfile class), repin projects' dependencies to the published conversations 0.7.4 / mementos 0.14.85 / todos 0.15.41 (the wave-pinned 0.7.5/0.14.86/0.15.43 were never published), sync recordings' Info.plist to 0.3.9 and secrets' runtime version literal to 0.3.4, and clear the publish-guard internal-infra string violations across connectors/emails/skills/secrets/telephony plus the guard's over-broad ARN/domain content patterns.

## 0.1.144

### Patch Changes

- Updated dependencies [4794bda]
  - @hasna/todos@0.15.46

## 0.1.143

### Patch Changes

- Updated dependencies [b8f1f5d]
  - @hasna/todos@0.15.45

## 0.1.142

### Patch Changes

- Updated dependencies [73f839e]
  - @hasna/todos@0.15.44

## 0.1.141

### Patch Changes

- a3bcfa7: HTTP transport budget reads reject with an error instead of returning a hardcoded empty list (fixes 9ddd325c), so a failed or unauthorized budget read can no longer present as a healthy zero.
- 95342c1: Local `listEvents` bounds the result and returns newest-first, matching the HTTP transport (fixes d731c1f8).
- Updated dependencies [5ff8f02]
  - @hasna/conversations@0.7.5

## 0.1.140

### Patch Changes

- e95d7bf: Budget reads parse `reset_at` as the zoneless UTC string it is stored as (fixes 654283bf), so budget state round-trips correctly over the HTTP transport.
- abb96c5: The registry DB opens with `busy_timeout=5000` so concurrent writers wait instead of failing with SQLITE_BUSY (fixes 4d266bd1).
- Updated dependencies [5275dde]
- Updated dependencies [1c859c2]
  - @hasna/mementos@0.14.86
  - @hasna/todos@0.15.43

## 0.1.139

### Patch Changes

- 247187d: Workspace-lock release is now holder-scoped by lock id (fixes 6692dc56): releaseWorkspaceLock deletes only the row whose unique id the caller acquired, so a holder whose guarded mutation outlives the 600s TTL can no longer delete a successor's live lock from a finally block. Key-only release is retained solely as the explicit admin force path (CLI unlock, MCP projects_unlock, DELETE /v1/locks/:key without lock_id).

## 0.1.138

### Patch Changes

- Updated dependencies [554a5b9]
- Updated dependencies [77b4808]
  - @hasna/contracts@0.13.4
  - @hasna/loops@0.5.11
  - @hasna/conversations@0.7.4
  - @hasna/todos@0.15.42

## 0.1.137

### Patch Changes

- Updated dependencies [e6134c1]
  - @hasna/todos@0.15.41

## 0.1.136

### Patch Changes

- Updated dependencies [d7d615b]
- Updated dependencies [d7d615b]
  - @hasna/conversations@0.7.3
  - @hasna/loops@0.5.9
  - @hasna/contracts@0.13.3
  - @hasna/todos@0.15.40

## 0.1.135

### Patch Changes

- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2
  - @hasna/conversations@0.7.2
  - @hasna/loops@0.5.8
  - @hasna/todos@0.15.39

## 0.1.134

### Patch Changes

- c8e6fec: Move the deployment workflow to the monorepo root (`.github/workflows/deploy-projects.yml`). The member-local `apps/projects/.github/workflows/deploy.yml` is removed and `scripts/ci/deploy-workflow.test.ts` is rewritten to test the root workflow.
- 0f5205b: Remediate image vulnerabilities in the Dockerfile — `apk upgrade --no-cache` in the build and runtime stages — and pin `undici` to 7.29.0 via an npm override.
- Release-lane fix: pin `@hasna/conversations` to 0.7.1 so the pre-bound project channel adoption path (`adoptExistingProjectChannel`, shipped in 0.1.133) resolves the SDK method instead of failing closed at runtime with `Conversations SDK does not expose adoptExistingProjectChannel`.
- Release-lane fix: the producer verification read-back path now projects the stored receipt through the same allowlist as the verification envelope before the exact canonical comparison, so the SDK-internal `prior_state` read-back field (introduced by conversations 0.7.x) is excluded while every envelope field is still compared exactly.

## 0.1.133

### Patch Changes

- c7256ff: Preserve a scalar integration projection when exactly one remaining resource link matches its value, and delete zero-match or ambiguous projections safely.

All notable changes to `@hasna/projects` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.132]

### Changed

- The hosted backend now requires an explicit API URL when an API key is present
  without `HASNA_PROJECTS_API_URL` (or the supported URL alias). The client reports
  a misconfiguration warning naming the missing variable instead of guessing a
  hardcoded default host. This removes the hardcoded host from the published
  artifact per the monorepo publish-guard rule; the host must be configured
  explicitly.

### Patch

- First release from the hasna/apps monorepo. The package was imported from
  hasna/projects with history preserved (import capsule 86a604070, import merge
  ff0c8e055); apart from the hosted-connection URL change above there are no functional
  changes since 0.1.131 — the rest of the delta is the import itself plus the
  monorepo workspace wiring (tsconfig bun-types→bun, ajv declared as a
  devDependency, changelog headings reconciled to 0.1.131). This patch establishes
  version ownership under the monorepo.

## [Unreleased]

### Changed

- Projects now selects the local SQLite registry or hosted HTTP API solely from
  API URL and API key presence. A partial pair fails closed, and the server
  health/version responses no longer expose the legacy deployment selector.

### Added

- `projects start` now posts a best-effort in-chat notification to the
  project's Conversations channel when it creates a tmux session that launches
  a coding agent. Notifications are enabled by default, can be disabled with
  `PROJECTS_AGENT_ONLINE_NOTIFICATIONS=0`, remain side-effect-free in dry runs,
  and are not repeated when an existing session is reused.

### Fixed

- Monorepo deploy pipeline: the container image now builds from the
  `apps/projects` member context with a standalone member `bun.lock` and the
  monorepo's own bun pin (1.3.14, asserted at build time). Previously the
  imported standalone-repo Dockerfile pinned bun 1.2 and the member lockfile
  had gone stale against the member manifest, so the frozen install refused
  (`lockfile had changes, but lockfile is frozen`) and no image could build
  from the monorepo. The deploy workflow now runs its build and `scripts/ci`
  helper steps with `working-directory: apps/projects`, matching the member
  layout.

## [0.1.131]

### Fixed

- Quarantine dry runs stay receipt-free: a dry-run WORKLOG registration no
  longer writes a receipt that later runs treat as a completed real run.

## [0.1.130]

### Added

- Transactional WORKLOG registration with duplicate quarantine: concurrent or
  repeated registrations of the same worklog entry are detected and quarantined
  instead of creating duplicate rows.

## [0.1.129]

### Fixed

- API typed-link validation errors are now surfaced on the response instead of
  being swallowed.
- Registration validates historical record drift before accepting a record.

## [0.1.128]

### Fixed

- Full project adoption is secured: adoption validates ownership and scope
  before applying.

## [0.1.127]

### Fixed

- Trusted npm releases now run contracts conformance and the no-cloud scan as
  explicit workflow gates, then publish with package scripts disabled so npm
  cannot rerun the full flaky suite after the reviewed gates have passed.

## [0.1.126]

### Fixed

- API-backed project resolution now accepts only verified package-owned
  canonical workspace paths, resolves them to their exact stable project IDs,
  and keeps absent, noncanonical, or mismatched paths fail-closed.
- `projects why` now reports truthful tried and matched diagnostics for verified
  canonical path resolution in API-backed contexts.

## [0.1.125]

### Changed

- Reissue the already-reviewed production verifier release through a
  publication source that preserves immutable registry `gitHead` provenance
  after npm 10.9.8 silently omitted it from linked-worktree publication
  0.1.124.

## [0.1.124]

### Fixed

- Local and PostgreSQL project-resource-link migrations now use the trusted
  production producer verifier by default, binding receipt lookup, exact
  readback, and inverse verification to Projects-owned authority, tenant,
  corpus, capability, and target state.
- Producer receipts are isolated by canonical project subject and manifest
  target, so a valid receipt from one project cannot authorize another
  project's migration.
- Canonical forward and inverse authority requests remain compatible with the
  shipped `@hasna/conversations` producer contract, while unsupported producer
  authorities fail closed.

## [0.1.123]

### Fixed

- Receipt-backed Conversations reconciliation can now query an explicit
  historical route, package version, authority ID, and corpus ID while keeping
  the current tenant and authority name as authorization boundaries. Projects
  validates the returned immutable receipt against that exact historical
  request and current target readback without weakening normal mutation
  receipt validation or rewriting provenance.

## [0.1.122]

### Fixed

- `projects register-full` can now explicitly reconcile orphaned Conversations,
  Todos project/task-list, and Mementos project resources only when an exact
  accepted or linked-duplicate source receipt and current full-ID readback
  prove the immutable target. Adopted resources remain outside rollback
  ownership, conflicts stay terminal, and Mementos path drift is reported as a
  required receipt-backed path-update CAS without exposing either path.

## [0.1.121]

### Fixed

- Full-project retrofit reconciliation now replaces only the exact typed links
  derived from the registration's accepted authority receipts, preserving
  unrelated Conversations channel, Todos project and task-list, and Mementos
  project links through success, exact retry, and rollback.
- Production full-project registration now fails closed before authority
  imports or mutation when an external authority omits transport provenance,
  hosted Projects is paired with a local authority, or local Projects is paired
  with a hosted authority.

## [0.1.120]

### Fixed

- The two subprocess-heavy CLI integration test files now use a file-local
  15-second default, covering their sequential command invocations without
  changing Bun's package-wide timeout policy or production behavior.

## [0.1.119]

### Fixed

- Hosted Conversations retrofit adoption now validates the shipped SDK's
  wrapped `getChannel` response before applying the exact channel ID, name,
  and project ownership checks.

## [0.1.118]

### Fixed

- Existing-row retrofit now adopts only authority resources already named by
  the Projects integration snapshot, proves their exact stable identity and
  readback, preserves descriptive channel metadata, and never takes rollback
  ownership of those pre-existing records. Unlinked resources, target-ID
  mismatches, cross-project channel claims, and readback drift still fail
  closed.

## [0.1.117]

### Fixed

- `projects register-full` now follows the configured hosted Projects authority
  instead of creating a machine-local shadow project, reconciles ambiguous
  creates through immutable operation provenance, and conditionally removes
  only the exact project and directory created by a failed attempt.
- Existing Projects rows can now be retrofitted only with an exact revision and
  claimed canonical path. Compatible directories, goals, and markers are
  adopted without taking rollback ownership, while revision drift, identity
  conflicts, changed operation payloads, and incompatible files fail closed
  with zero new residue.
- Full registration applies compatibility integrations and typed resource links
  through one guarded authority mutation, validates integration values at the
  API boundary, and restores the previous revision on later-step failure.

## [0.1.116]

### Fixed

- Guarded project updates now accept `kind`, `primary_path`, and `git_remote`
  through the CLI, return the final SQLite primary-location postimage and
  revision, and preserve those identity fields through guarded rollback,
  including restoration of remote-only projects with retained non-primary
  forward locations.

## [0.1.115]

### Fixed

- `projects register-full` now uses the shipped Todos, Mementos, and
  Conversations production authorities through configured HTTP clients or
  explicit local database paths instead of unavailable stubs, and fails closed
  before imports when an authority has neither complete API configuration nor
  an explicit database path.
- Full registration now carries exact request and precondition digests through
  receipt lookup, replays accepted external IDs for duplicate requests,
  reconciles ambiguous committed results from the matching receipt, and limits
  inverse compensation to receipt-owned targets.

## [0.1.114]

### Fixed

- Project-context bundle hashes now remain stable across generation times by
  excluding volatile `generated_at` and self-referential `hash` fields from the
  digest input while preserving durable payload changes. Stable project-context
  bundle hash: `sha256:7174664168026ee4f3210d10897b18e3677562f33f5de76e671cc98d86764b87`.

## [0.1.113]

### Added

- SQLite project-data consumers can atomically delete exact record and model
  targets through one package-owned `BEGIN IMMEDIATE` operation on a
  caller-owned connection. The operation verifies canonical project ownership,
  affected counts, record-before-empty-model ordering, post-delete state, and
  rolls back every partial write on mismatch without exposing transaction
  control to the caller.

### Fixed

- Guarded workspace metadata updates now advance their SQLite `updated_at`
  revision monotonically even when the wall clock is equal or moves backwards,
  so stale `expected_revision` tokens are rejected deterministically.

## [0.1.112]

### Fixed

- Contacts authority URLs now use the same canonical URI representation as
  typed Project resource links, so attach results, exact retries, listing,
  detach, and reattach recognize the same service instance with or without a
  trailing slash.

## [0.1.110]

### Added

- Typed project resource links now accept Todos `task` targets identified by
  complete external UUIDs, preserve Contacts compatibility, and enforce the
  same closed contract across the CLI, SDK, OpenAPI, SQLite, and PostgreSQL.

## [0.1.109]

### Fixed

- API-backed `projects start` operations now write events and
  `last_opened_at` through the hosted project store instead of a machine-local
  SQLite database, avoiding foreign-key failures for hosted-only projects.
- PostgreSQL event recording now stores `null` when a CLI-provided agent ID is
  not registered with the service, allowing start events from machine-local
  agent identities to succeed.

## [0.1.108]

### Added

- Typed project resource links now accept `@hasna/orgs` organization and
  project nodes, preserve them through SQLite and PostgreSQL migrations, and
  project single links to `orgs_org_id` and `orgs_project_id` compatibility
  integrations.

## [0.1.107]

### Added

- `projects context-bundle <exact-project-id> --json` now emits a strict,
  bounded Projects v1 context bundle with authoritative project, integration,
  station, freshness, command, and deterministic hash fields for managed
  Instructions rendering.

### Fixed

- Successful, non-dry-run `projects start` operations now record
  `last_opened_at` through both SQLite and API-backed project stores, including
  guarded mutation and rollback support.

## [0.1.106]

### Fixed

- `projects register-full` now accepts canonical lowercase immutable
  Conversations channel IDs in `chn_<32hex>` form, while preserving legacy
  UUID channel IDs and continuing to fail closed on uppercase or malformed
  identifiers.

## [0.1.105]

### Added

- `projects resource-links-read`, `resource-links-add`,
  `resource-links-reconcile`, and `resource-links-rollback` now manage a
  closed, typed one-to-many collection of Todos, Conversations, Knowledge, and
  Mementos resources by exact stable project id and compare-and-swap revision.
- SQLite, PostgreSQL, the HTTP API, CLI, OpenAPI schema, and generated SDK now
  share immutable link identity, mutable labels, deterministic idempotent
  receipts, bounded complete readback, duplicate prevention, project
  registration projections, and rollback to the exact accepted forward state.

## [0.1.104]

### Added

- `projects register-full` now provides a feature-gated, fail-closed
  cross-authority registration transaction with capability preflight,
  deterministic idempotency, immutable bounded receipts, exact-ID readback, and
  attempt-scoped compensation that never deletes pre-existing resources.

### Fixed

- Full-registration rollback now tracks accepted external writes before local
  receipt persistence, detects drift across all supported project state,
  preserves explicit slugs when compatibility normalization is disabled, binds
  inverse requests to their exact desired payload and digest, and accepts only
  correctly linked duplicate inverse receipts on retry.

## [0.1.103]

### Fixed

- `projects store ensure` now supports API-backed projects by complete stable
  `wks_...` id. It performs a bounded exact-record read, collision-checks and
  provisions the station-local canonical app store idempotently, and uses the
  guarded conditional receipt/rollback path only when the hosted project is
  missing its primary path. Guarded read/update/receipt/rollback operations are
  now all represented in OpenAPI and the generated SDK.
- API-backed `projects store ensure` now reconciles ambiguous hosted mutation
  outcomes through the exact guarded receipt before compensating local state.
  Accepted receipts preserve and finalize the store; only terminal
  nonacceptance authorizes cleanup; unresolved outcomes preserve local state.
- Guarded exact-ID operations now accept the complete opaque character set
  generated by Projects, including `_` and `-` immediately after `wks_`, while
  continuing to reject slugs, names, paths, whitespace, partial IDs, and
  malformed IDs.

## [0.1.97]

### Fixed

- **`projects list` returned one server-capped page and called it the whole
  registry.** Every list path issued a single request and returned the body
  verbatim. The API clamps a list response to 1000 rows and reports no `total`,
  so a full page and a complete result were indistinguishable — and the local
  CLI default compounded it, capping at 100. Measured on installed `0.1.96`:
  `projects list --json` returned **100** rows containing **5** `iproj-*`
  projects; the same command on this branch returns **2352** rows containing
  **108** `iproj-*`, exit code 0. Callers were silently deciding that projects
  did not exist.

  List reads now walk `offset` until the server stops producing rows, via a new
  `collectPages` helper ([`src/store/paginate.ts`](src/store/paginate.ts)). The
  page stride is learned from the first response rather than hardcoded, so a
  server that raises or lowers its cap needs no client change. A server that
  ignores `offset` — which would otherwise spin forever handing back the same
  page — is detected by row identity and raises `PaginationError` instead of
  returning a quietly truncated list. `--limit N` still returns exactly N and
  stops paging there.

### Changed

- List responses now carry `total`, `has_more` and `complete` so a caller can
  tell a full page from a finished walk. `GET /v1/projects` reports the same
  fields, and the OpenAPI document describes them.

### Known limitation

- This ships the **client** fix only. The deployed `/v1/projects` service still
  returns at most 1000 rows with no `total`, so a direct HTTP caller that does
  not page is still truncated. The service has been stuck on a 2026-07-23 image
  since the deploy workflow began failing on 2026-07-24; that is tracked
  separately and is not addressed here.

## [0.1.96]

Release-only version bump. The changes below were merged in
[#41](https://github.com/hasna/projects/pull/41) without a version bump, so the
published `0.1.95` — and therefore every machine on the fleet — still shipped
`KIND_CHANNEL_RULES` and kept minting `internal-<slug>` channel names for kinds
`generic`, `project`, `docs`, `scaffold` and `remote-only`. Verified 2026-07-30:
`npm view @hasna/projects version` reported `0.1.95` while the installed
`dist/cli/index.js` at that version still contained the table, and the merged
regression test `derivation never IMPOSES an "internal-" prefix, for any kind`
fails against that build.

### Changed

- **BREAKING — channel derivation no longer imposes a prefix.** `deriveProjectChannel`
  rewrote the project slug through two hardcoded tables that were this package's
  private copy of the fleet channel naming convention. `KIND_CHANNEL_RULES`
  pinned kind `project` to an `internal-` prefix, and the anti-double-prefix
  guard only recognised prefixes listed in `CHANNEL_PREFIX_CLASSES`, which had
  no `iproj-` row — so `iproj-agent-ceo` derived `internal-iproj-agent-ceo`.
  `classifyProjectChannelName` guessed the class from the same list and fell
  back to `package`, which is why no channel on the fleet ever carried the
  convention's `work-project` class. Both tables are removed. The derived
  channel is now the normalized slug, verbatim: no prefix is added and none is
  stripped (including the former `open-` strip for `open-source` projects).
  An explicitly linked `integrations.conversations_channel` still wins over
  derivation, which is what keeps channels named under the old behaviour
  resolving to the history they hold.
- **BREAKING — `channel_class` is now resolved from the project, and nullable.**
  `classifyProjectChannelName` and `CHANNEL_PREFIX_CLASSES` are removed from the
  SDK surface, replaced by `resolveProjectChannelClass`: an explicit
  `integrations.conversations_channel_class` (new,
  `PROJECT_CHANNEL_CLASS_INTEGRATION_KEY`), else the project kind, else `null`.
  `ProjectChannelDerivation.channel_class` is `ProjectChannelClass | null`, and
  `--class` is omitted rather than guessed when it is `null`, leaving the
  default to `conversations`, which owns `metadata.channel_schema.class`.
  `PROJECT_CHANNEL_CLASSES` gains `work-project`.

  Note the practical reach: `generic` is by far the largest kind in the
  registry and maps to `null`, so most newly created project channels now carry
  no class where 0.1.95 sent `initiative`. That label was itself inferred from
  the deleted `internal-` prefix rule, so it was unfounded rather than correct —
  but this is a behaviour change on the dominant path, not just a type change.
  `experiment` maps to `null` for a related reason: the `initiative` class the
  old table assigned it additionally requires the channel topic to carry
  `owner:<agent> until:<date|gate-id>`, which nothing here can supply.

- **BREAKING — `ensureProjectChannel` no longer writes the project record.**
  It previously persisted the resolved channel onto
  `integrations.conversations_channel`. For a _derived_ name that write is
  one-way: an explicit link outranks derivation permanently, so the first
  `projects start` after a derivation change would pin the new name and keep
  resolving to it even after the change was reverted, silently moving a project
  off the channel holding its history. Ensure now only makes the channel exist;
  the link is established at project creation or deliberately by an operator.
  The `persist` option and the `persisted` result field are removed —
  `linked` and `side_effects.integration_linked` report the record's state.

  Consequence, and the reason the next entry exists: with nothing writing the
  link, the overwhelming majority of projects resolve their channel by
  derivation rather than storing it — 1460 of 1527 (96%) by a per-kind
  enumeration, and the same ratio holds on a wider 2332-row sample. Both counts
  are floors: `projects list` truncates, which is filed separately.

- **Display and bundle surfaces fall back to derivation.** `projects show`,
  `projects context` and `projects handoff` read
  `integrations.conversations_channel` directly and would therefore have gone
  blank for those 96%. `projects handoff` is the bundle an agent reads to find
  out where to post, so a `null` there is worse than a stale value. All three
  now use `projectChannelSummary`, which falls back to the derived name and
  reports `conversations_channel_source: "integration" | "derived"` alongside
  it, so the surface stays useful without pretending a derived name is pinned.
  `projects show` marks a derived channel `(derived)`.
- `ProjectChannelResolution` gains `warnings`, so an unusable
  `conversations_channel_class` is reported on the read path
  (`projects channel <x> --json`) and not only when `--ensure` is passed.

## [0.1.95]

### Fixed

- **Grouped tmux sessions moved into a group outside the CLI keep the project
  working directory** ([#2](https://github.com/hasna/projects/issues/2),
  duplicate of [#1](https://github.com/hasna/projects/issues/1)). 0.1.93 anchored
  the groups Projects itself creates and made `createWindow()` fall back to
  `#{session_path}`, but a session added to a group by hand
  (`tmux new-session -t <project> -s <peer>`) still records the cwd of the shell
  that ran the move — usually `/home/<user>`. tmux resolves the start directory
  of a window opened by an _attached_ client from that session cwd, so grouped
  windows opened by hand kept landing outside the project. `projects start` now
  realigns every session in the target session's group onto the project path
  (new `alignGroupedSessionWorkingDirectories()` / `listSessionLocations()` /
  `setSessionWorkingDirectory()` helpers). Ungrouped sessions are deliberately
  left untouched, so shared sessions keep the cwd of whoever created them, and a
  failed realign can never fail a start.

## [0.1.94]

### Fixed

- **`projects create` no longer drops registry flags in the hosted backend
  ([#27](https://github.com/hasna/projects/issues/27)).** The hosted branch
  forwarded only `name`/`slug`/`description`/`kind`/`root`/`recipe`/`tags` plus
  the raw `--metadata-json`/`--integrations-json` blobs, so `--path`,
  `--git-remote` and every management/integration flag (`--stage`,
  `--priority`, `--owner`, `--launch-profile`, `--start-agent`,
  `--start-command`, `--start-session-policy`, `--start-windows-json`,
  `--todos-project-id`, `--todos-task-list-id`, `--brief-id`, `--brief-path`)
  were silently ignored, producing a bare row that then had to be repaired with
  `projects update --path`. Registry input is now parsed and merged once, ahead
  of the store branch, and forwarded to the hosted create exactly as it is for a
  local create.

### Changed

- **`projects create` now fails before creating a row when machine-local
  runtime flags are requested in the hosted backend
  ([#27](https://github.com/hasna/projects/issues/27)).** `--mkdir`,
  `--git-init`, `--marker`, `--tmux-session`, `--tmux-windows-json` and
  `--tmux-profile` cannot be applied to a hosted project row, and no hosted-backend
  command can apply them afterwards. Instead of creating the row and silently
  skipping the runtime work (leaving a partial, row-only project), the command
  now exits non-zero with a `local-only operation ...` message naming the
  offending flags, and issues no create request at all. Use `--dry-run` to
  preview the full local plan.
- **Tests no longer inherit the operator shell's hosted API selectors.** A new
  `testSpawnEnv()` helper (and the matching in-process guard) strips
  `HASNA_PROJECTS_API_URL`/`HASNA_PROJECTS_API_KEY` unless a test opts into api
  connection explicitly, so `bun test` exercises the local store instead of silently
  running against — and creating real rows in — the live hosted registry.

## [0.1.93]

### Fixed

- **Grouped tmux sessions no longer lose the project working directory**
  ([#1](https://github.com/hasna/projects/issues/1)). `createGroup()` created
  the group session with neither a start directory nor a group target, so the
  session was anchored in the working directory of whatever process created it
  (typically `/home/hasna`). Because tmux resolves a new window's start
  directory from the client's cwd — and grouped sessions share their window
  list — every window opened in the group landed in `/home/hasna` instead of
  the project path. `createGroup(name, { cwd, windowName, group })` now passes
  `-c <project path>` and joins an existing group with `-t` (omitting `-n`,
  which tmux rejects alongside `-t`).
- **`createWindow()` falls back to the session's own start directory.** When no
  explicit `cwd` is supplied, the window start directory is now resolved from
  `#{session_path}` (new exported `sessionPath()` helper) instead of silently
  inheriting the CLI process cwd. The resolved path is escaped through the same
  tmux format-literal guard as explicit paths, and window creation still
  succeeds when the lookup fails.
- **`projects channel --ensure` no longer reports total failure after its side
  effects landed (the hosted backend).** `ensureProjectChannelViaStore` performs
  three independent mutations — create the Conversations channel, persist
  `integrations.conversations_channel`, append a `channel_ensured` audit event.
  The final step POSTs to `/projects/:id/events`, which the hosted API does not
  serve, so a fully completed ensure exited 1 with a raw
  `Hasna request failed: POST /projects/<id>/events -> 404` while the channel
  and the project link were already committed. Agents then treated a linked
  channel as missing and retried into drift. The audit event is now recorded
  best-effort and reported through a non-fatal `warnings` entry; the store
  read-back and the integration link are fenced too, so a failure there returns
  a structured result instead of throwing a raw transport error. (#28)
- **Ensure results now carry structured partial-state evidence.**
  `ProjectChannelEnsureResult` gained `warnings: string[]` and
  `side_effects: { channel_created, channel_present, integration_linked,
event_recorded }`, both surfaced in `projects channel --ensure --json` and
  printed on failure in text mode, so a retry is informed rather than blind.
  Ensure remains idempotent: a second run on an existing, already-linked channel
  reports `status: "exists"` with no duplicate write.
- **The derived channel class is passed to Conversations.** `channel create` is
  now invoked with `--class <package|product|initiative|loop-lane>` and
  `--topic`, so project channels satisfy the fleet naming/class convention
  instead of landing without `metadata.channel_schema.class`. Older
  `conversations` builds that reject those flags are detected and retried with
  the previous minimal arg set.

## [0.1.92]

### Added

- **Projects secret redaction across every output surface.** New
  `src/lib/redaction.ts` scrubs secret-shaped keys (password/token/api*key/
  client_secret/authorization/cookie/dsn/connection_string/…), URL credentials,
  `Authorization` headers, secret CLI flags, `ENV=value` assignments, PEM
  private-key blocks, and known token prefixes (`sk-`, `ghp[*]`, `github*pat[*]`,
`npm\_`, `xox*`, `AKIA…`). It is wired through CLI JSON/text printers, the MCP
JSON-RPC tool responses, the SDK row mappers (`rowTo*`), the dashboard/reports
  servers, and the agent context/handoff/runs surfaces, and is also applied at
  write time for agent-run and workspace-event records.
- **`projects permissions repair` (CLI) and `projects_permissions_repair` (MCP)
  plus SDK export.** Dry-run by default; `--apply` tightens local Projects
  registry DB/WAL/SHM, backups, canonical stores, and (optionally) registered
  project report and dashboard artifacts to private modes (0600/0700). Skips
  symlinks, never deletes, and reports per-path actions.

## [0.1.91]

### Security

- **Scrub internal infra identifiers from the shipped `README.md`.** The
  Storage Sync section named the internal production RDS cluster and the
  Secrets Manager runtime-secret path in prose and an `export` example.
  `README.md` ships in the published npm tarball (`files`), so these leaked to
  every installer. Replaced with generic, operator-supplied guidance ("your
  PostgreSQL connection string"); the package ships no default database,
  cluster, or secret-manager identifier. Also dropped the stale
  `projects storage status/push/pull` command examples from that block (those
  subcommands were removed in the 0.1.90 `ProjectStore` reconciliation).
  The runtime-code leak (the removed `getCanonicalProjectsRdsConfig()` constants
  echoed by the old `storage status` CLI/MCP surface) was already eliminated in
  0.1.90; this is the last remaining occurrence, in documentation only.

## [0.1.90]

### Reconciled

- **`main` reconciled with the published npm line.** `main` (0.1.84) had
  diverged from the deployed `@hasna/projects@0.1.89`: the published
  `ProjectStore` seam refactor (0.1.85–0.1.89 — unify the registry behind one
  `ProjectStore` and route all CLI + MCP registry / status / dashboard /
  GitHub-import / coordination / hosted API writes and the prompt-agent through
  the Store to kill split-brain, plus the production Docker prod-deps image fix)
  was live on npm but never landed on `main`, while a set of `main`-only
  CLI/UX fixes had never been published. This release merges the published tag
  into `main`, preserving both histories, so npm and `main` agree again.
  Overlapping storage/backend/canvas surfaces were reconciled in favour of the
  published `ProjectStore` seam while keeping the `main`-only behaviour: the
  canvas `upsert`/`compose` CLI + MCP tools and the `assertLocalOnlyWrite`
  guard now resolve targets, read data models, record events and inspect the
  app store through the Store instead of the removed direct-DB / `http/backend`
  helpers.

### Fixed (previously unpublished on `main`)

- `projects sessions` with no target reports recent project start sessions
  aggregated across all projects instead of failing with `Project not found`.
- `projects events record` fails fast with a clear local-only message in
  the hosted backend instead of silently writing local sqlite or leaking a raw
  upstream `404` for `POST /projects/:id/events`.
- Generic project canvas blocks + canvas geometry hardening, dashboard render
  manifest imports and linked-canvas surfacing, the dashboard Todos provider
  link, subcommand `--help`/`-h` routing to commander, shell completion derived
  from the live CLI surface, and `projects create --dry-run` no-persist
  semantics in the hosted backend.

## [0.1.89]

### Fixed

- **Prompt-agent cloud-write split-brain**: in the hosted backend the LLM
  prompt-agent (`projects agent "..."` / MCP `projects_agent_prompt`) now
  routes every shared-registry mutation through the `ProjectStore` (hosted HTTP
  `<url>/v1`) instead of writing directly to local sqlite. Previously
  only `projects_create` used the store; `update`, `archive`, `unarchive`,
  `delete`, `tag`, `untag`, `integration_unlink` and `event_record` wrote to
  the local island while the project lived in the hosted registry, and target
  resolution read local. The per-project local-only sub-resources
  (`agents_assign`, `locations_add`) now surface the store's
  `LocalOnlyOperationError` as a clean tool error in the hosted backend rather than
  silently writing local sqlite. Local connection behavior is unchanged.

## [0.1.84] - 2026-07-07

### Fixed

- Hardened generic canvas block validation so malformed public layout,
  viewport, explicit position, width, or height JSON fails fast instead of
  generating invalid React Flow canvas geometry.

### Tests

- Added regression coverage for malformed canvas block geometry through the
  typed compiler, CLI `projects canvases compose`, and MCP
  `projects_canvases_compose` / `projects_canvases_upsert` JSON-RPC calls.

## [0.1.83] - 2026-07-07

### Added

- Added generic scalable canvas composition for Projects canvases:
  `projects canvases compose <project>` compiles domain-neutral block/link specs
  into React Flow nodes and edges, and `projects canvases upsert <project>`
  idempotently creates or updates a canvas by slug from either raw React Flow
  JSON or block specs.
- Added a typed `project-canvas-blocks` library layer and SDK exports for
  composing reusable blocks such as summary cards, tables, groups, links,
  roadmap/checklist cards, and hierarchy-style views without adding a one-off
  org-chart command.
- Added MCP parity for the new canvas surface through
  `projects_canvases_upsert` and `projects_canvases_compose`.

### Fixed

- Preserved existing dashboard render imports when `projects dashboard render
--write` rewrites `.hasna/project/dashboard/render.json`, and exposed linked
  stored canvases plus dashboard imports in the default dashboard render model.
- Made dashboard server canvas routes use the enriched dashboard render so
  linked canvases/imports remain visible when served.
- Removed the broken unpublished `@hasna/mcp-harness` dev dependency and kept
  the MCP HTTP transport local to this package using the official MCP SDK
  web-standard transport, restoring install/typecheck/build safety.

### Added

- **Project -> conversations channel linkage** (fleet comms workflow, todos
  task `c4bee3e0`): the channel name is stored on the project record as
  `integrations.conversations_channel` and derived from the slug + kind per
  the fleet channel naming convention when unset (`open-source` -> flat repo
  name, `platform` -> `platform-*`, `internal-app` -> `iapp-*`,
  `company-website` -> `cweb-*`, `community` -> `community-*`, `experiment` ->
  `research-*`, everything else -> `internal-*`; already-prefixed slugs are
  kept as-is).
- **Ensure-channel on create/start** — `projects create` and `projects start`
  create the conversations channel when missing (create-first probe against
  the `conversations` CLI, 15s timeout, never fatal: failures surface as
  `channel.status === "error"`), link it on the project record, and record a
  `channel_ensured` audit event. Opt out with `PROJECTS_CHANNEL_ENSURE=0`;
  defaults off under `NODE_ENV=test`.
- **Channel resolution surface parity** — `projects channel [target]` CLI
  command (prints the bare channel name for loops/scripts; `--json`,
  `--ensure`, `--from`, `--dry-run`), `projects_channel` MCP tool,
  `projects_channel` prompt-agent tool (approval-gated ensure), and SDK
  exports (`deriveProjectChannel`, `resolveProjectChannel`,
  `resolveProjectChannelForProject`, `ensureProjectChannel`).
- `projects link --conversations-channel <name>`, `channel` integration alias,
  `conversations_channel` in the `conversations` unlink group, agent
  context/handoff integration payloads, and `projects show` channel line.

## [0.1.79] - 2026-07-06

### Added

- **`projects-serve` HTTP API** — a new hosted HTTP surface for the project
  domain. Unauthenticated probes `GET /health`, `/ready`, `/version` (each
  returns `{status, version}`) plus `GET /openapi.json`, and an
  API-key-guarded versioned `/v1` covering project (workspace) CRUD
  (`/v1/projects` list/create/get/patch/delete + `/archive`, `/unarchive`,
  `/events`) and roots/agents/recipes. Amendment A1 direct PostgreSQL: the service
  reads and writes PostgreSQL directly through the vendored storage kit,
  with no local cache or sync engine.
- **API-key authentication** via `@hasna/contracts/auth` (`verifyApiKey`) —
  stateless HMAC-verified `hasna_projects_*` tokens with `projects:read` /
  `projects:write` scope gating and DB-backed revocation.
- **Generated SDK** (`@hasna/projects/sdk`) — a typed, dependency-free
  `ProjectsClient` generated from the serve OpenAPI document
  (`bun run sdk:generate`), plus `createProjectsClientFromEnv()` for the
  `PROJECTS_API_URL` + `PROJECTS_API_KEY` hosted convention.
- **Hosted PostgreSQL storage + migrations** — vendored `@hasna/contracts` storage kit under
  `src/generated/storage-kit`, a `migrations/` directory, and a migration runner
  (`projects-serve migrate`) driven by the kit's checksum-guarded ledger.
- **Container + deploy** — ARM64 Bun `Dockerfile`, `docker-compose.yml`,
  `hasna.contract.json` manifest, and a `.github/workflows/deploy.yml` pipeline
  for building/pushing the image and rolling the ECS service.

## [0.1.78] - 2026-07-04

### Added

- Added `projects reports serve` to browse registered project report files over
  HTTP, rendering Markdown reports with light/dark typography and serving HTML
  reports as-is.

## [0.1.69] - 2026-06-29

### Fixed

- Hardened project dashboard serving: non-loopback hosts now require an
  explicit dashboard access token or explicit `--trust-network`, and token mode
  uses a browser unlock endpoint instead of self-issuing cookies to any visitor.
- Kept dashboard snapshot, render, and validate commands read-only unless
  `--write` is passed.
- Removed generic top-level dashboard aliases so prompt-agent routing is not
  hijacked by natural-language prompts starting with words such as `render` or
  `validate`.

## [0.1.67] - 2026-06-28

### Added

- Canonical ID-based project store support:
  `$HASNA_PROJECTS_HOME/workspaces/<workspace_id>/` for physical workspace
  folders and `$HASNA_PROJECTS_HOME/data/<workspace_id>/` for runtime state.
- `projects store inspect`, `projects store ensure`, and dry-run-first
  `projects store migrate` with explicit `--apply`/`--yes` migration, plan
  artifacts, previous-location registration, marker rewrite, and verification.
- `projects labels` / `projects label` commands for add/remove/list workflows
  over normalized project tags, plus `--label` filters on `projects list` and
  targetless `projects start`.
- `projects oss matrix`, a bounded routing matrix for open-source workspace
  roots that reports repo paths, package metadata, git status, tmux hints, and
  best-effort latest task/PR refs for `open-*` work.

### Changed

- Rootless non-remote project creation now defaults the primary path to the
  canonical ID-based workspace store unless an explicit path or root is passed.
- Documented labels as metadata/query filters rather than path identity.

## [0.1.65] - 2026-06-26

### Added

- Compact terminal defaults for noisy project list/detail/history commands,
  with `--limit` and `--verbose` controls while keeping `--json` detailed.
- Opt-in compact MCP summaries via `compact: true` while preserving existing
  full-record defaults for MCP clients.
- Agent-assist CLI commands and MCP tools to help coding agents orient, decide,
  and continue: `projects context` (one-shot priming bundle), `projects next`
  (high-leverage next-action suggestions), `projects why` (resolution trace and
  fix tips), `projects handoff` (cross-agent/machine handoff bundle), and
  `projects runs list` / `projects runs show` (prompt-agent run ledger read
  view). All emit JSON (`-j/--json`) or LLM-friendly text (`--for-agent`), and
  are exposed as `projects_context`, `projects_next`, `projects_why`,
  `projects_handoff`, `projects_runs_list`, and `projects_runs_show` MCP tools.
- `--for-agent` output mode for the agent-assist commands: compact, references
  resolved, truncated long values.
- Goal-continue Cursor `stop` hook (`.cursor/hooks.json` +
  `.cursor/hooks/goal-continue.sh`) that blocks an agent's stop with a
  continuation prompt when an active goal is set, folding in `projects next`
  suggestions. Modeled on the codewith `/goal` slash command.

### Changed

- Prompt-agent project list/show/event tools now use compact wrapper payloads by
  default and point agents to verbose detail lookups when needed.

## [0.1.64] - 2026-06-24

### Added

- Root open-source release and community files: `CHANGELOG.md`, `SECURITY.md`,
  `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md`.
- npm package metadata now includes the changelog, security policy,
  contribution guide, and code of conduct in the publish whitelist.

### Fixed

- Hardened tmux session and window creation against project path and cwd command
  injection by invoking `tmux` with argv arrays, using tmux `-c` cwd arguments,
  and escaping tmux `#(...)` format command substitution.
- Added regression tests covering shell `$()` and tmux-native `#()` path/cwd
  injection cases.

## [0.1.63] - 2026-06-24

### Fixed

- Bulk project start now reports individual start failures without losing the
  successful results.

## [0.1.62] - 2026-06-24

### Added

- JSON Render specs for project list, detail, start, status, sessions, roots,
  and recipes surfaces.
- GitHub root scan/sync support for configured project roots.

## [0.1.60] - 2026-06-20

### Fixed

- Hardened project budget enforcement.

## Historical Releases

### Changed

- Earlier package versions were published before this changelog existed. Use the
  git history and npm registry metadata for detailed provenance before `0.1.60`;
  the only pre-existing repository tag was `v0.1.47`.
