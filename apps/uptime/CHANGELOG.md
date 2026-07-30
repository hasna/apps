# Changelog

All notable changes to `@hasna/uptime` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.70] - 2026-07-31

### Changed

- Renamed the CLI binary from `uptime` to `uptimemon`. The old name shadowed the
  system `uptime` command (procps) on `PATH`, and this package is a monitor
  management CLI rather than a system-uptime reporter. The Docker images now
  install `/usr/local/bin/uptimemon` alongside the retained `uptime` shim, and
  the documented command in the README and `docs/` is `uptimemon`. `uptime-mcp`
  is already namespaced and is unchanged.

### Deprecated

- Deprecated the `uptime` binary name. It is still installed and fully
  functional for this transition release, and now prints a single deprecation
  line to **stderr** — never stdout, so `--json` output stays machine-readable —
  before running the CLI normally. The name will be removed in a future release
  once known callers have moved to `uptimemon`.

### Added

- Added a fail-closed public OSS release gate with a machine-readable `HOLD`
  decision, online GitHub/npm state checks, runtime dependency notice and
  license verification, full-history credential scanning, and an explicit
  approval/provenance requirement.
- Added `release:oss:verify`, the post-publish half of the release gate. It
  verifies on the registry the provenance attestation, signature, and `gitHead`
  that only a completed publish can produce, and the release workflow runs it
  immediately after `npm publish`. The pre-publish gate treats the absent
  version as expected state and requires the capability to mint provenance
  instead, so an approved `GO` candidate can actually be published.

### Security

- Added a trusted-publishing release workflow that publishes with
  `npm publish --provenance` under `id-token: write`, and made the OSS gate run
  before the existing build, typecheck, and test prepublish checks. The
  provenance request lives in the workflow rather than in `publishConfig`,
  because npm refuses to publish at all when `publishConfig.provenance` is set
  outside a supported CI provider.

## [0.1.69] - 2026-06-30

### Added

- Added a bounded hosted Postgres probe API adapter for explicit
  `hostedPostgresProbeRuntime` wiring. The adapter supports admin-scoped probe
  enrollment, probe-scoped check-job claims, signed probe result submission, and
  optional audit events through workspace-scoped Postgres storage.

### Changed

- Clarified zero-count cloud rollback guidance to prefer a Terraform
  source/package/image re-pin path instead of assuming previous ECS task
  definition revisions remain active after replacement.
- Hosted probe API responses no longer expose raw public key material, and
  hosted probe listing, job creation, heartbeat, revocation, rotation, and
  worker scale-out remain blocked until their promotion evidence exists.

## [0.1.68] - 2026-06-30

### Added

- Added a bounded hosted Postgres report-control-plane adapter for
  `/api/v1/report-schedules*`, `/api/v1/report-runs`, and
  `/api/v1/audit-events` when `createApiHandler` is supplied an explicit
  `hostedPostgresReportRuntime`. The adapter keeps hosted report execution
  fail-closed while allowing schedule metadata, report-run reads, and audit
  reads to use workspace-scoped Postgres storage.

### Fixed

- Hosted report schedules now require explicit `channelRefIds` instead of
  boolean fan-out selectors or raw Mailery/Telephony/Open Logs destination
  config.
- Hosted report schedule create/update/delete mutations now use atomic
  Postgres audit helpers with actor/origin/idempotency provenance, request-hash
  idempotency replay checks, and expected-revision guards for updates and
  tombstones.
- Hosted report-run and audit-event API responses no longer expose raw artifact
  storage refs, fencing tokens, SQL internals, or unsafe audit text/metadata.

## [0.1.67] - 2026-06-30

### Fixed

- Forwarded `offset` from hosted monitor list API requests to the Postgres
  runtime so clients can page beyond the first bounded result set.
- Added an expected-revision guard to hosted Postgres monitor PATCH writes so a
  stale update cannot resurrect a concurrently tombstoned monitor row.
- Made hosted monitor PATCH idempotency keys replay through the audit layer
  without creating repeated monitor revisions or audit rows.
- Updated packaged AWS module defaults and deployment metadata examples to
  `@hasna/uptime@0.1.67`.

## [0.1.66] - 2026-06-30

### Added

- Added an explicit hosted Postgres monitor-control-plane adapter option for
  `/api/v1/summary` and `/api/v1/monitors*`. When supplied, hosted monitor
  create/list/get/update/delete use the async Postgres runtime with workspace
  scoping, actor/origin/idempotency metadata, audit rows, and monitor
  tombstones instead of reading or writing the SQLite bridge.

### Changed

- Hosted Postgres monitor PATCH now preserves omitted fields, ignores raw
  status/last-check body fields, and resets status plus last-check metadata
  when the monitor target definition changes.
- Hosted routes that are not backed by the Postgres adapter now stay
  fail-closed instead of falling back to SQLite when the adapter is active.
  API errors from adapter-backed paths are sanitized before they are returned.
- Updated packaged AWS module defaults and deployment metadata examples to
  `@hasna/uptime@0.1.66`.

## [0.1.65] - 2026-06-30

### Changed

- Hardened reporter promotion evidence so
  `HASNA_UPTIME_REPORTER_PROMOTION_EVIDENCE_JSON` must include a safe
  `workspaceId` that matches the active reporter workspace whenever promotion
  evidence is supplied. Missing promotion evidence still blocks by default, and
  hosted reporter startup remains fail-closed behind the broader worker gates.
- Updated packaged AWS module defaults and deployment metadata examples to
  `@hasna/uptime@0.1.65`.

## [0.1.64] - 2026-06-30

### Added

- Added a sanitized reporter promotion-evidence contract through
  `HASNA_UPTIME_REPORTER_PROMOTION_EVIDENCE_JSON` and
  `buildPostgresReportRuntimeReadiness`. The contract can mark approved
  artifact object-store, Open Logs audit export, delivery alarm, and reporter
  liveness evidence as proven only when the evidence is redacted,
  workspace-matching, reviewed, and smoke-backed.
- Added `reporter-worker-liveness` to hosted reporter preflight output so the
  CLI exposes the same promotion gate as the SDK readiness object.
- Included public `docs/*.md` and `docs/*.json` files in the npm package so the
  AWS runbook, cloud source-of-truth, operational tracking, and product
  contracts are available from the package tarball while the GitHub repository
  remains private pending explicit approval.

### Changed

- Updated packaged AWS module defaults and deployment metadata examples to
  `@hasna/uptime@0.1.64`.
- Kept hosted reporter startup fail-closed even when promotion evidence is
  supplied; service-store integration, channel secret loading, worker leases,
  and other hosted worker gates still block `canStart`.

## [0.1.63] - 2026-06-30

### Added

- Added sanitizer coverage for CloudFront and ALB origin verification header
  values when they appear in AWS-shaped evidence fields such as `HeaderValue`
  and `HttpHeaderConfig.Values`.
- Added `allow_origin_verify_header_before_backend_state_hardened` to make
  pre-hardening origin-header setup or rotation an explicit zero-count exception
  instead of an implicit operator action.

### Changed

- Updated protected-access runbook guidance to treat origin-header rotations,
  Terraform plan JSON, CloudFront distribution reads, and ALB listener-rule
  reads as secret-bearing operator artifacts even when summaries are sanitized.

## [0.1.62] - 2026-06-30

### Added

- Added hosted reporter callback contracts for redacted report artifact object
  writes and sanitizer-safe Open Logs audit export payloads. The SDK validates
  redacted artifact bodies, hash/byte-size matches, hash-only suggested object
  keys, safe storage refs, retention metadata, deterministic audit event ids,
  and redacted exporter results before recording report metadata.
- Exported `buildHostedUptimeReport`, `writePostgresReportArtifact`,
  `buildPostgresReportAuditEvent`, and `exportPostgresReportAuditEvent` from
  the public SDK surfaces.

### Changed

- Updated hosted reporter preflight to distinguish implemented artifact/audit
  callback contracts from still-blocked approved S3/Open Logs wiring, delivery
  alarms, and live worker liveness evidence.
- Documented the at-least-once artifact writer boundary and the need for
  object-store reconciliation or lifecycle cleanup around failed metadata
  transactions.
- Updated release metadata defaults for the packaged AWS module to
  `@hasna/uptime@0.1.62`.

## [0.1.61] - 2026-06-30

### Added

- Added an SDK and CLI evidence sanitizer for shared rollout evidence. The new
  `sanitizeEvidenceInput` SDK export and `uptime evidence sanitize` CLI redact
  raw AWS identifiers, CloudFront/ALB hosts, private URLs, Terraform artifacts,
  image digests, local paths, recipients, bearer/provider tokens, database URLs,
  and unsafe object keys before evidence is copied into docs, todos, project
  metadata, or release notes.
- Added `uptime cloud evidence-sanitize` as a cloud-rollout alias for existing
  operator scripts. Both commands emit sanitized JSON; the top-level command
  supports `--fail-on-unsafe` for CI, while the cloud alias fails on unsafe
  evidence by default and requires `--allow-unsafe` for private inspection.

### Changed

- Updated release metadata defaults for the packaged AWS module to
  `@hasna/uptime@0.1.61`.

## [0.1.60] - 2026-06-30

### Changed

- Enforced the shared hosted target policy inside `PostgresRuntime.upsertMonitor`
  before any monitor row is written, so direct Postgres monitor ingestion now
  rejects loopback, metadata, private DNS, private/reserved IP, secret fragment,
  and unsafe TCP targets using the same policy family as hosted API/import and
  worker review paths.
- Codified Postgres monitor ingestion as a `hosted-public` target-policy
  boundary. Private targets still require future inventory-backed provenance,
  and enabled `browser_page` monitors remain blocked until browser evidence
  workers are configured.
- Updated release metadata defaults for the packaged AWS module to
  `@hasna/uptime@0.1.60`.

## [0.1.59] - 2026-06-30

### Added

- Added `uptime cloud postgres-private-probe preflight` to inspect an enabled
  private probe identity, expected machine/location/fingerprint bindings, and
  private job/lease counts from the Postgres runtime without enabling hosted
  private probe workers.
- Exported `buildPostgresPrivateProbePreflight` and `getProbeIdentity` runtime
  support for SDK consumers that need the same fail-closed private-probe
  identity review.

### Changed

- Kept private probe startup and promotion blocked even when Postgres identity
  review passes. Hosted probe routes still require service/API integration,
  heartbeat, revocation, rotation, inventory-backed private targets, alarms, and
  live operational evidence.
- Updated operational tracking to record `0.1.59` as published with
  private-probe preflight evidence, and added a readiness snapshot that
  separates zero-count evidence from live-readiness blockers.

## [0.1.58] - 2026-06-30

### Changed

- Redacted `cloud edge-smoke` evidence output now hides edge URL,
  direct-origin URL, workspace id, and smoke id by default. Raw edge evidence
  URLs are available only with `--raw-evidence-urls` for private operator
  terminals.
- Tightened direct-origin denial evidence to the fixed HTTP `403` origin
  verification denial, with explicit unreachable-origin evidence still allowed
  only for private-network models.
- Changed generic AWS dry-run plan output and runbook evidence guidance to use
  secret/resource classes, booleans, and counts instead of concrete secret refs
  or resource identifiers in shared evidence.

## [0.1.57] - 2026-06-30

### Added

- Added a worker runtime metrics SDK and package export for the default-off
  CloudWatch alarm contract. The SDK emits CloudWatch EMF envelopes with the
  exact `OpenUptime/Worker` metric names and `Service`, `Stage`, `Role`
  dimensions used by Terraform.
- Added opt-in `--emit-cloudwatch-emf` review telemetry for bounded Postgres
  scheduler and public-probe runs. Scheduler metrics use post-run backlog and
  stale-lease counts; public-probe metrics count submission failures separately
  from policy skips and cancellations.

### Changed

- Kept hosted worker `canStart=false`, ECS worker commands fail-closed, and
  Terraform `worker_runtime_metric_producers_ready=false` by default. Reporter
  metric helpers exist, but hosted reporter worker promotion remains blocked on
  secret loading, S3 artifacts, audit export, alarms, and live liveness evidence.

## [0.1.56] - 2026-06-29

### Added

- Added default-off Terraform worker runtime alarm contracts for scheduler,
  public-probe, and reporter roles. The contract covers backlog, stale lease or
  heartbeat age, probe submission failures, reporter lag, failed deliveries, and
  retry-exhausted deliveries while keeping hosted worker scale-out blocked until
  the workers emit those metrics and approved alert delivery is proven.

## [0.1.55] - 2026-06-29

### Changed

- Aligned the packaged Terraform `runtime_package_version` default and public
  deployment metadata example with the published package version so package
  consumers do not build an older runtime by default.
- Added a public operational status vocabulary for distinguishing package
  releases, private image refreshes, zero-count deploys, live scale-out, and
  cloud-primary promotion.
- Clarified rollback instructions for zero-count image refreshes so restoring a
  previous web task definition keeps desired count `0` unless live scale-up
  gates already passed.

## [0.1.54] - 2026-06-29

### Added

- Added a fenced Postgres report-run state machine for hosted reporter review
  work: schedule claims can now begin a deterministic schedule-window report run,
  finish it with its own worker lease/fencing token, and advance the schedule in
  the same transaction.
- Added schema version 6 Postgres migration coverage for report run
  `pending/running/succeeded/failed/retry_exhausted` states, nullable
  `finished_at`, worker lease fields, versioning, and a unique schedule-window
  index.
- Added regression coverage for stale schedule completion, two-worker report-run
  fencing, failed delivery retry metadata, and migration verification of the new
  report-run index.

### Changed

- Delivery attempt idempotency no longer depends on `scheduled_at`, so replays of
  the same report run/channel/attempt number use a stable key.
- Reporter preflight now treats report-run metadata and the fenced report-run
  state machine as implemented when schema evidence is supplied, while still
  blocking live reporter start on approved secret loading, S3 artifact writes,
  audit export, delivery alarms, and worker liveness.

### Security

- Terminal delivery-attempt completion now clears active worker claim fields, and
  failed delivery attempts must include `nextRetryAt` or use `retry_exhausted`.

## [0.1.53] - 2026-06-29

### Added

- Added transactional Postgres report schedule/window claiming with worker
  leases and fencing tokens so hosted reporter review code can claim a due
  schedule exactly once before creating delivery attempts.
- Added redacted report schedule channel summaries for Postgres schedule claim
  records so due discovery and claims never expose raw recipients or provider
  endpoint payloads.
- Added schema version 5 Postgres migration coverage for report schedule lease
  fields and the report schedule due index.

### Changed

- Reporter preflight now treats report schedule/window claiming as implemented
  while still blocking live reporter start on service-store promotion, channel
  secret loading, the report run state machine, S3 artifact writes, audit
  export, delivery alarms, and worker liveness.

## [0.1.52] - 2026-06-29

### Security

- Hardened the packaged AWS VPC endpoint policies so ECR, logs,
  Secrets Manager, SSM, STS, KMS, and S3 endpoint paths use service-keyed
  principal scopes instead of wildcard endpoint principals.
- Added a service-keyed `additional_vpc_endpoint_principal_arns` escape hatch
  for reviewed shared-VPC principals, with S3 gateway endpoint restrictions
  enforced through `aws:PrincipalArn` conditions.

## [0.1.51] - 2026-06-29

### Changed

- Updated the packaged Terraform tfvars example so
  `runtime_package_version` matches the published package version.

## [0.1.50] - 2026-06-29

### Changed

- Reissued the 0.1.49 public package sanitization through npm publishing so the
  registry package metadata carries a source `gitHead` for the release commit.

## [0.1.49] - 2026-06-29

### Changed

- Replaced the default cloud memory preflight machine id and public examples
  with generic operator-machine names.
- Genericized public cloud readiness docs so concrete deployment evidence,
  private account choices, local machine names, and operator state remain in
  private deployment metadata.

### Security

- Replaced realistic-looking AWS account and secret-ref examples in the packaged
  Terraform tfvars template with explicit placeholders.

## [0.1.48] - 2026-06-29

### Added

- Added opt-in Terraform support for AWS Backup Vault Lock with retention-window
  validation, non-secret lock configuration outputs, tfvars examples, and
  deployment runbook guidance. The lock remains disabled by default so
  operators can review the retention policy before applying any irreversible
  account state.

## [0.1.47] - 2026-06-29

### Security

- Hardened the AWS evidence bucket policy to deny explicit non-KMS object
  uploads and object uploads that specify a KMS key other than the configured
  Open Uptime KMS key.
- Added explicit Terraform live-ops readiness gates for backend state,
  human/on-call alert delivery, backup/restore evidence, and evidence retention
  before the web service can scale above zero.

## [0.1.46] - 2026-06-29

### Added

- Added `sendHostedUptimeReport` on the SDK export for server-side hosted
  report delivery through selected, workspace-scoped Mailery, Telephony, and
  Open Logs channel refs.

### Changed

- Reporter preflight now distinguishes metadata-writer readiness from full
  reporter-worker promotion readiness and explicitly blocks on missing schedule
  claiming, report-run state machine, channel-ref secret-loader IAM wiring, S3
  artifact writes, Open Logs audit export, delivery alarms, and live worker
  liveness evidence.
- Hosted report delivery requires explicit selected channel ref ids instead of
  fan-out to every enabled workspace ref.
- Expanded third-party notices for the Postgres client dependency family.

### Security

- Hosted report delivery masks monitor target URLs, hosts, ports, and
  target-like incident text before creating Mailery, Telephony, Open Logs, or
  request-hash payloads.
- Hosted delivery evidence now redacts provider-echoed recipients, phone
  numbers, target refs, secret refs, API URLs, and bearer/send-key material; raw
  target refs are represented only as hashes.
- Postgres report delivery attempts now reject mismatched channel/provider pairs
  such as `email` with `logs`.
- Hosted reporter startup remains blocked and ECS desired counts must remain
  zero until the remaining cloud runtime gates are proven.

## [0.1.45] - 2026-06-29

### Fixed

- Added an `/usr/local/bin/uptime` wrapper to both runtime Dockerfiles so
  package-built hosted images expose the app CLI directly and version smokes can
  validate `uptime --version` without relying on the internal Bun command path.

## [0.1.44] - 2026-06-29

### Added

- Added `uptime cloud postgres-scheduler run` for bounded, explicit-workspace
  Postgres scheduler review batches that create deterministic `check_jobs` for
  due public-safe HTTP/TCP monitors without promoting generic hosted workers.
- Added `runPostgresSchedulerWorker` on the `@hasna/uptime/workers` SDK export
  with interval-aligned schedule slots, bounded catch-up, producer-side hosted
  target-policy checks, and audit metadata for created jobs.

### Changed

- Postgres runtime now exposes workspace-scoped scheduler monitor discovery and
  excludes unsupported monitor kinds and monitors that already have open
  pending/claimed/expired jobs for the same revision.
- Postgres check-job creation can safely reactivate soft-deleted, cancelled, or
  empty-snapshot historical rows for the same deterministic job key instead of
  failing scheduler replays.
- The Postgres public-probe worker requests due jobs for its concrete probe id
  so class and location policy are filtered before claiming. It also rejects
  wrong-workspace discovery rows before attempting a claim, and refuses
  non-public probe-policy jobs before network execution.

### Security

- Hosted worker startup remains blocked: scheduler/public-probe/reporter generic
  ECS commands still fail closed, healthcheck preflight still returns
  `canStart=false`, and ECS desired counts remain zero by default.
- The new scheduler command supports only public probe policy until private
  target inventory/provenance exists, and refuses public jobs for hosted-denied
  URLs, hosts, or DNS answers. Its bounded worker defers denied targets for the
  current monitor interval so permanently blocked rows cannot starve later
  public-safe monitors across repeated batches.

## [0.1.43] - 2026-06-29

### Added

- Added `uptime cloud postgres-public-probe run` for bounded, explicit-workspace
  Postgres public-probe review batches from existing `check_jobs`.
- Added `runPostgresPublicProbeWorker` on the `@hasna/uptime/workers` SDK export
  so private validation can exercise the Postgres claim, execution, cancellation,
  and submission path without promoting the generic hosted worker entrypoint.

### Changed

- Bumped the reviewed Postgres cloud schema contract to version 4 so
  `check_jobs` store an immutable `monitor_snapshot` for the monitor revision
  they were created from.
- Postgres check-job creation now snapshots the enabled monitor row inside the
  workspace transaction, and probe result submission updates monitor status only
  when the current monitor revision still matches the job revision.
- The Postgres public-probe runner cancels unsupported, disabled, missing, or
  stale-revision claimed jobs with a fenced `cancelClaimedCheckJob` update
  instead of broad tombstone mutation.

### Security

- Hosted worker startup remains blocked: `uptime cloud workers run --role
  public-probe` still fails closed, healthcheck preflight still returns
  `canStart=false`, and ECS desired counts remain zero by default.
- The new Postgres public-probe command is not the EFS SQLite
  `cloud public-checks` bridge, does not create schedule slots, does not enable
  hosted probe API routes, and does not make hosted worker preflight
  promotion-ready.
- Worker errors are sanitized before rendering so database URLs, bearer
  material, and other credential-shaped values are not printed in CLI JSON or
  terminal output.

## [0.1.42] - 2026-06-29

### Added

- Added a Postgres core runtime facade with workspace-scoped transactions,
  monitor upsert/tombstone methods, probe identity storage, deterministic
  `check_jobs` creation, due discovery, claim/fencing/completion helpers,
  probe submission replay protection, audit event writes, and sync tombstones.
- Added `@hasna/uptime/postgres-runtime` SDK exports and hosted worker preflight
  evidence for the bounded Postgres runtime capabilities.

### Changed

- Bumped the reviewed Postgres cloud schema contract to version 3 so
  `probe_identities` include `probe_location` and `probe_submissions` include
  monitor revision, schedule slot, class/location, policy hash, and payload hash.
- Added explicit v2-to-v3 Postgres upgrade statements for those columns instead
  of relying only on `CREATE TABLE IF NOT EXISTS` definitions.
- Report and core Postgres runtimes now use the configured RLS workspace setting
  instead of hardcoding `app.workspace_id`.
- Postgres check-job claim retries by the same probe now preserve the active
  fencing token, successful duplicate probe submissions return the existing
  result, and tombstones soft-delete every advertised resource type.

### Security

- Postgres runtimes now reject non-TLS database URLs when they create their own
  pool and require an explicit workspace in hosted mode.
- Hosted worker startup remains blocked: the core runtime facade is not yet
  wired into `UptimeService`, hosted API routes, worker loops, alarms, deploy
  drain, or live ECS scaling.

## [0.1.41] - 2026-06-29

### Added

- Added a Postgres report-runtime helper for finished report-run metadata,
  report delivery-attempt state, per-attempt idempotency, retry/backoff
  metadata, stale-lease reclaim, and redacted report artifact metadata refs.
- Added reporter preflight checks that expose the narrower report-runtime
  metadata capabilities while keeping hosted reporter startup blocked.

### Security

- Report-runtime writes use transaction-scoped workspace settings on a checked
  out Postgres client, avoid returning stale fencing tokens from discovery,
  require live leases for completion, store report JSON only as hash metadata,
  and reject raw recipient or URL-shaped delivery refs.
- Hosted reporter `canStart` remains false even when report-runtime schema
  evidence is present; S3 artifact writes, audit export, alarms, and full
  cloud-store promotion remain blocked.

## [0.1.40] - 2026-06-29

### Added

- Expanded the Postgres cloud-store migration plan with workspace-scoped
  `report_delivery_attempts` and `report_artifacts` tables, RLS policies, and
  verification indexes for hosted report retry/idempotency state and redacted
  artifact metadata.
- Added regression coverage proving the new report delivery/artifact tables are
  included in dry-run and apply verification targets without printing database
  credentials.

### Changed

- Hosted reporter preflight now distinguishes schema-planned report delivery
  attempts/artifacts from the still-blocked runtime state machine, S3 artifact
  write path, retry/backoff, audit export, and delivery alarms.

## [0.1.39] - 2026-06-29

### Changed

- `uptime cloud memory-preflight` now recognizes existing canonical live
  metadata environment names for Projects, Todos, and Conversations as
  configuration evidence without printing or depending on the secret values.

### Security

- Canonical live metadata only satisfies the configuration check. The selected
  operator machine and service cloud-primary status still require audited proof
  envs, sync evidence, and the existing Open Uptime Postgres/runtime blockers to
  be resolved.

## [0.1.38] - 2026-06-29

### Added

- Added `uptime cloud memory-preflight` as a redacted, fail-closed promotion
  gate for cloud-backed project/task memory and operator-machine readiness.
- Added regression coverage for healthcheck exit behavior, built CLI
  availability, per-machine proof-env binding, and redaction of database URLs,
  API keys, secret refs, secret-looking machine IDs, and canonical secret paths.

### Security

- The memory preflight does not promote an operator machine, does not scale
  hosted workers, and keeps Notes and Open Uptime blocked until Notes has
  audited cloud metadata/object storage and Open Uptime has an authoritative
  async Postgres runtime adapter with leases, report storage, and probe fencing.

## [0.1.37] - 2026-06-29

### Changed

- Updated AWS Terraform defaults and deployment metadata examples to point at
  the current package version.

### Security

- Expanded one-shot report integration URL rejection and provider-error
  redaction for additional credential-shaped query fields including `key`,
  `sig`, `signature`, `jwt`, and OAuth-style `code` values.

## [0.1.36] - 2026-06-29

### Added

- Added workspace-scoped hosted report channel-ref readiness checks so reporter
  preflight only treats refs for the current `HASNA_UPTIME_WORKSPACE_ID` as
  startable input.
- Added package export/bin/packlist regression coverage and stricter Postgres
  schema-contract tests for workspace/idempotency metadata.

### Changed

- Hosted worker `--healthcheck` is now readiness-like and exits non-zero while
  `canStart=false`.
- The temporary hosted public-checks EFS SQLite bridge now requires
  `--allow-public-checks-bridge` or `HASNA_UPTIME_ALLOW_PUBLIC_CHECKS_BRIDGE=1`.
- Raw broad hosted tokens are rejected by default; local compatibility now
  requires `HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN=1`.

### Security

- One-shot report delivery URLs now reject secret-shaped query parameters and
  provider-echoed secret query values are redacted.
- Hosted reporter delivery remains fail-closed until Postgres/cloud store,
  report-run/delivery-attempt state, idempotency, retry/backoff, artifact
  storage, audit export, and alarms exist.

## [0.1.35] - 2026-06-29

### Changed

- CloudFront origin requests now forward `X-Uptime-Workspace` and
  `Idempotency-Key` in addition to auth, token, origin, and content-type
  headers, so protected-edge smoke can prove header-based workspace and
  idempotency behavior instead of relying only on query strings.
- `uptime cloud edge-smoke` now includes a header-only workspace readiness check
  and sends an `Idempotency-Key` on the mutation cleanup delete.
- Deployment docs now call out the required public-edge header contract for
  future promotion evidence.

### Security

- This release does not scale hosted services or make runtime promotion-ready.
  It only closes a protected-edge forwarding gap required before live
  token-bearing traffic.
- Origin verification header-name validation now rejects `Idempotency-Key` and
  `X-Uptime-Workspace` so the secret CloudFront-only verification value cannot
  collide with viewer-controlled app headers.

## [0.1.34] - 2026-06-29

### Added

- Added `uptime cloud postgres-migrate` and the `@hasna/uptime/postgres` SDK
  export for redacted Postgres migration dry-runs and explicit schema applies.
- Added migration-runner safeguards for TLS database URLs, `--confirm-schema`
  apply confirmation, transactional DDL, idempotent RLS policy creation,
  `FORCE ROW LEVEL SECURITY`, and table/policy/index verification.
- Added regression coverage for migration dry-runs, guarded applies, rollback
  redaction, missing-policy/index verification, and migration worker preflight.

### Changed

- Migration worker preflight can now distinguish a ready Postgres schema
  migration runner from the still-blocked runtime Postgres store.
- Hosted promotion remains blocked until the async Postgres runtime store,
  workspace-scoped transactions, cloud leases, reporter state, alarms, and
  edge/product readiness gates are implemented.

## [0.1.33] - 2026-06-29

### Added

- Added hosted report channel-ref catalog validation for service-owned Mailery,
  Telephony, and Open Logs secret references without accepting raw destinations,
  tokens, URLs, or client-submitted secret refs.
- Added reporter worker preflight evidence for configured channel-ref catalogs
  while keeping hosted reporter startup blocked on the remaining cloud store,
  lease, retry, audit, artifact, and alarm gates.
- Added regression coverage for rejecting monitor URLs with embedded
  credentials and for stamping Open Logs report deliveries with a source event
  id.

### Changed

- Hosted report docs now describe the approved channel-id contract and clarify
  that clients must not submit provider credentials, raw recipients, or secret
  references.

## [0.1.32] - 2026-06-29

### Added

- Added local deterministic probe check-job identity using workspace,
  monitor revision, schedule slot, and probe-policy hash.
- Added probe workspace/class/location/machine metadata, probe-policy metadata
  on jobs and results, and payload-hash replay conflict detection.
- Added regression coverage for two-scheduler job idempotency, monitor
  revision and probe-policy separation, same-probe claim retries, probe
  class/location enforcement, and conflicting nonce payloads.

### Changed

- Same-probe job claim retries now return the existing fencing token instead of
  silently rotating it.
- Local CLI and MCP probe job surfaces can specify workspace, probe class,
  probe location, machine id, and job probe policy.
- Hosted readiness now treats every SQLite bridge mode as non-promotion-ready
  until the async cloud store is implemented.
- AWS cloud-plan defaults now follow the package version instead of a stale
  literal package version.

## [0.1.31] - 2026-06-29

### Added

- Added `uptime cloud postgres-plan` and the `@hasna/uptime/postgres-plan` SDK
  export for a blocked, redacted Postgres schema/RLS/tombstone review artifact.
- Added hosted SQLite bridge tombstones for monitor deletes, including
  actor/origin/idempotency metadata and regression coverage.

### Changed

- Hosted store, service, and import-preview paths now require explicit
  workspace context for hosted reads and mutations.
- Replaced monitor table-level name uniqueness with an active-monitor partial
  unique index so tombstoned hosted monitors do not permanently reserve names.
- Updated cloud source-of-truth docs to describe the current hosted storage
  bridge contract and the target Postgres migration shape.

## [0.1.30] - 2026-06-29

### Changed

- Documented Bun as the required runtime for npm-managed global installs.
- Pinned the package image builder and runtime base images by registry digest.

## [0.1.29] - 2026-06-29

### Changed

- Removed internal operator runbooks and cloud architecture/gap documents from
  the published npm package while keeping repository docs and the reusable
  `infra/aws` Terraform module intact.
- Added explicit global upgrade instructions to the README and removed the
  private GitHub advisory link from the packaged security policy.

## [0.1.28] - 2026-06-29

### Added

- Added non-secret Terraform outputs for CloudFront distribution id, ALB
  listener ARNs, ALB security group id, and web target group ARN so protected
  web origin evidence can be collected without reading origin header material.

### Changed

- Updated AWS deployment docs to prefer no-secret origin evidence commands and
  explicitly avoid shared logs from APIs that can include the CloudFront origin
  verification header value.

## [0.1.27] - 2026-06-29

### Added

- Added authenticated hosted `/ready` readiness reporting with schema, table,
  SQLite quick-check, and hosted production data-mode gates.
- Added `uptime cloud edge-smoke` and the `@hasna/uptime/edge-smoke` SDK export
  for protected edge promotion evidence without printing token values.

### Changed

- Updated AWS deployment docs to require the repeatable edge smoke before
  treating web scale-up as protected live access, and clarified that zero-count
  deployments are provisioned infrastructure, not live service.

## [0.1.26] - 2026-06-29

### Added

- Added explicit hosted worker preflight and fail-closed run entrypoints for
  scheduler, public-probe, reporter, and migration roles.
- Added a bounded `uptime cloud public-checks worker` loop around the existing
  hosted public-check smoke primitive for EFS SQLite bridge testing.

### Changed

- Updated AWS non-web task definitions to use explicit fail-closed worker
  commands and environment-aware preflight health checks instead of the
  placeholder `cloud plan` command.
- Hardened Terraform scale-up validation so `web > 0` in CloudFront mode
  requires origin verification and either HTTPS-origin mode or explicit
  `allow_cloudfront_http_origin_live_traffic` risk acceptance.

## [0.1.25] - 2026-06-29

### Added

- Added an opt-in CloudFront HTTPS-origin path for the AWS module. Operators can
  set `cloudfront_origin_protocol_policy = "https-only"` with a dedicated
  origin hostname and matching ACM certificate before token-bearing live
  traffic, while the default zero-count bridge remains unchanged.
- Added AWS ECS service tag propagation and managed tags so service-launched
  tasks keep cost allocation tags.
- Added optional `runtime_package_integrity` verification for the CodeBuild
  image builder and included the published `bun.lock` in package images so
  production dependency installs can use `--frozen-lockfile`.

## [0.1.24] - 2026-06-29

### Added

- Added a workspace-scoped `cloud public-checks run-due` CLI path and SDK
  service methods for bounded hosted HTTP/TCP check execution with hosted target
  policy enforcement. This is a one-off smoke/runtime primitive; the EFS SQLite
  bridge still keeps scheduler, public-probe, reporter, and migration services
  scaled to zero until cloud leases and worker loops are implemented.

## [0.1.23] - 2026-06-28

### Fixed

- Added hosted audit rows for monitor create, update, and delete API
  mutations, including workspace and actor metadata.
- Scoped monitor provenance and audit events by workspace with a schema
  migration while keeping schema v4 backups restorable.
- Applied hosted runtime target-policy DNS/IP checks to TCP monitors.
- Kept hosted `browser_page` monitors disabled until browser evidence workers
  are configured.

## [0.1.22] - 2026-06-28

### Fixed

- Clarified production hosted-token errors and docs to cover both explicit
  hosted auth production mode and `NODE_ENV=production`.
- Added built CLI entrypoint regression coverage for packaged hosted startup
  rejecting raw hosted tokens under `NODE_ENV=production`.

## [0.1.21] - 2026-06-28

### Fixed

- Fixed hosted production auth mode detection in bundled package output so
  `NODE_ENV=production` rejects legacy raw hosted tokens unless scoped hosted
  token JSON is configured.

### Changed

- Included all cloud deployment docs in the npm package so package consumers
  receive the runtime security, source-of-truth, metadata, and runbook context.

## [0.1.20] - 2026-06-28

### Added

- Added hosted-token JSON descriptor parsing from
  `HASNA_UPTIME_HOSTED_TOKENS` and JSON-compatible
  `HASNA_UPTIME_HOSTED_TOKEN` values, allowing deployed secrets to provide
  scoped workspace tokens instead of one broad raw token.

### Changed

- Updated hosted auth docs and AWS runbook guidance to prefer scoped static
  operator tokens for zero-count smokes while keeping full production
  identity/RBAC as a live gate.

## [0.1.19] - 2026-06-28

### Added

- Added optional CloudFront origin verification header binding to the AWS
  Terraform module. When enabled, CloudFront sends a private origin header and
  the ALB listener returns `403` for direct origin requests that do not present
  the matching value.

### Changed

- Updated AWS runbooks, deployment metadata, and cloud source-of-truth docs to
  distinguish CloudFront prefix-list narrowing from distribution-bound origin
  access.

## [0.1.18] - 2026-06-28

### Changed

- Added explicit ECS container health checks to the AWS Terraform module task
  definitions. The web task checks `/health`, while disabled non-web roles use
  a hosted-environment sanity check until their worker entrypoints are enabled.
- Updated cloud planning and AWS deployment docs to keep the zero-count
  deployment status clear while the private root is repinned and verified.

## [0.1.17] - 2026-06-28

### Fixed

- Added Alpine `libgcc` and `libstdc++` runtime packages to the packaged
  production Dockerfile so the copied Bun binary can run in the final image.
- Read Open Logs structured ingest IDs from nested `events[]` responses when
  recording report delivery receipts.

## [0.1.16] - 2026-06-28

### Changed

- Changed the packaged production Dockerfile to install Bun in an ECR Public
  Node Alpine build stage, then copy only Bun, app files, and production
  dependencies into an ECR Public Alpine runtime with CA certificates. This
  reduces inherited OS vulnerability findings before live AWS scale-up.

## [0.1.15] - 2026-06-28

### Changed

- Changed the packaged production Dockerfile to use Docker Official
  `node:22-slim` from Amazon ECR Public and install Bun inside the image. This
  avoids Docker Hub unauthenticated pull-rate limits during AWS CodeBuild image
  builds.

## [0.1.14] - 2026-06-28

### Added

- Added explicit Terraform NAT task egress support. Infra owners can set
  `enable_nat_task_egress = true` to allow web and non-public worker task
  security groups to reach AWS public APIs through a private subnet NAT route on
  TCP/443 when private VPC endpoints are not the approved egress model.

## [0.1.13] - 2026-06-28

### Added

- Added opt-in Terraform support for private AWS VPC endpoints. Infra owners can
  enable interface endpoints for ECR API, ECR Docker, CloudWatch Logs, and
  Secrets Manager, plus an S3 gateway endpoint when private route tables are
  provided.

## [0.1.12] - 2026-06-28

### Added

- Added hosted HTTP runtime target-policy checks through `runHostedHttpCheck`.
  The runner resolves DNS at execution time, rejects denied answers, pins the
  validated address into the request, validates redirects, and records
  target-policy decision evidence.
- Added `isBrowserPageEvidence` and `isHttpTargetPolicyEvidence` SDK helpers for
  narrowing the expanded `CheckEvidence` union.

### Changed

- Tightened hosted target policy coverage for reserved IPv4 documentation and
  benchmark ranges plus IPv4-compatible, translation, transition, documentation,
  and other special-purpose IPv6 forms.
- Updated AWS planning and runbook docs so public probes remain blocked until
  cloud check-job workers are wired to the hosted HTTP runner and validated in
  AWS.

## [0.1.11] - 2026-06-28

### Changed

- Added Terraform outputs for log groups, web alarms, backup vault, and backup
  plan, KMS key ARN, and secret refs so the AWS runbook can use output-driven
  commands.
- Expanded the AWS deployment runbook restore drill with AWS Backup restore-job,
  polling, staging mount-target, validation, and cleanup steps.
- Made the AWS runbook command blocks use explicit shell variables and
  consistent Terraform working-directory flags.
- Hardened hosted target policy to normalize IPv4-mapped IPv6 literals before
  rejecting loopback, private, link-local, metadata, carrier-grade NAT,
  unspecified, and multicast IPv4 ranges.
- Hardened hosted target policy to reject the full IPv6 link-local `fe80::/10`
  range.
- Scoped hosted import preview lookups by workspace so preview responses cannot
  reveal monitors from another hosted workspace.
- Documented DNS resolution, redirect, and rebinding enforcement as required
  gates before enabling hosted public probe execution.

## [0.1.10] - 2026-06-28

### Changed

- Added hosted workspace scoping for monitor, result, incident, summary, and
  report API reads/writes so hosted tokens cannot see other workspace data.
- Normalized and redacted probe-submitted browser evidence before persistence.
- Expanded the AWS deployment runbook with zero-count apply, image digest,
  secret metadata, smoke test, logs, alarms, backup, restore drill, report gate,
  rollback, and evidence-capture procedures.
- Sanitized the tracked project descriptor so deployment-specific local ids and
  machine labels stay in private metadata rather than the public repo.

## [0.1.9] - 2026-06-28

### Changed

- AWS Terraform EFS mount targets now use stable list-index keys so deployment
  roots can create private subnets and Open Uptime resources in one plan.
- AWS Terraform resources now include owner/project/environment/cost-center tags
  and optional AWS Budgets alerts when recipients are configured.

## [0.1.8] - 2026-06-28

### Added

- CloudFront default-domain protected web access mode for first AWS deployment,
  with ALB HTTP restricted to CloudFront origin-facing ranges.
- Hosted public-origin allow-list support through
  `HASNA_UPTIME_ALLOWED_ORIGINS`, wired by the AWS template for CloudFront and
  custom HTTPS access modes.

### Changed

- AWS Terraform and cloud-plan defaults no longer require custom Route53/ACM
  inputs for the first protected web deployment path.

## [0.1.7] - 2026-06-28

### Added

- Explicit hosted EFS-backed SQLite runtime path with
  `HASNA_UPTIME_HOSTED_SQLITE_DB` and `hosted-efs-sqlite` health metadata.
- AWS Terraform EFS file system, access point, ECS volume mount, and AWS Backup
  plan for the hosted SQLite data store.
- `Dockerfile.package` plus AWS CodeBuild image-builder Terraform resources to
  build the published npm package into ECR without relying on local Docker.

### Changed

- Hosted AWS deployment artifacts no longer inject `HASNA_UPTIME_DATABASE_URL`;
  the async Postgres adapter remains future work.
- The EFS-backed SQLite bridge is single-writer only: one web task maximum and
  scheduler/public-probe/reporter services remain disabled until Postgres and
  cloud leases exist.

## [0.1.6] - 2026-06-28

### Added

- Bun-based hosted runtime `Dockerfile` and `.dockerignore`.
- Reviewable Terraform/OpenTofu AWS starter plan under `infra/aws` for ECR,
  S3 evidence storage, ECS/Fargate services, ALB/TLS/DNS, task roles,
  CloudWatch logs, security groups, and secret refs.
- Cloud plan SDK/CLI fields that point to `Dockerfile` and `infra/aws` with
  format/init/validate/plan commands while keeping apply disabled.

### Security

- AWS infra templates use secret ARNs/valueFrom references and example
  placeholders only; no plaintext service tokens, database URLs, or private keys
  are stored in the repo.
- Terraform desired counts default to zero until hosted cloud-store/auth/probe
  blockers are closed.

## [0.1.5] - 2026-06-28

### Added

- Dry-run AWS deployment plan generator for a reviewed AWS target,
  covering ECS/Fargate services, ECR image commands, ALB/RDS/S3/Secrets/Logs
  resources, rollback steps, and safety assertions.
- Private-probe hosted-targeted preflight config generator with JSON and
  env-file rendering.
- CLI commands `uptime cloud plan` and `uptime cloud private-probe-config`.
- SDK export `@hasna/uptime/cloud-plan`.
- Machine-readable `blocked`/`canApply:false` and `blocked`/`canStart:false`
  gates plus blocker/evidence lists for AWS and private-probe planning artifacts.

### Security

- Cloud planning artifacts contain secret names/refs and file paths only; they
  do not inline AWS credentials, hosted tokens, or private probe key material.
- Cloud plan generation is dry-run only and does not call AWS.
- Dry-run AWS output avoids copy-pastable live AWS mutation commands.

## [0.1.4] - 2026-06-28

### Added

- Local scheduled uptime reports with persisted schedules, run history, and due
  execution through Mailery email, Telephony SMS, and Open Logs.
- CLI commands under `uptime report-schedules` plus `uptime audit`.
- Local API and MCP surfaces for report schedules, report runs, and audit
  events.
- Immutable local audit events for report schedule create/update/delete/run
  actions.

### Changed

- Bumped the local SQLite schema to version 3 while keeping schema version 1
  and 2 backups restorable when they only lack newer probe/report/audit tables.
- Hosted report schedule routes fail closed until cloud channel refs, workspace
  stores, and audit logging are implemented.

### Security

- Persisted report schedules reject inline API keys and tokens; scheduled runs
  resolve Mailery/Open Logs credentials from environment variables or future
  cloud channel refs.
- Audit metadata redacts token/key/secret-like fields before persistence.

## [0.1.3] - 2026-06-28

### Added

- Private/local probe identities, check jobs, fenced signed submissions, and
  probe signing helpers exported from `@hasna/uptime/probes`.
- CLI commands for `uptime probes create`, `uptime probes jobs create`,
  `uptime probes jobs claim`, and `uptime probes submit`.
- Local API and MCP probe surfaces for public-key enrollment, job
  creation/claiming, and signed result submission.

### Changed

- Bumped the local SQLite schema to version 2 while keeping schema version 1
  backups restorable when they are only missing the new probe tables.
- Hosted probe ingest fails closed until cloud check jobs, workspace stores, and
  audit logging are implemented.

### Security

- API and MCP probe enrollment require caller-managed public keys; generated
  private keys are written only by the CLI to an explicit private-key file.
- Probe job reads redact fencing tokens outside the claim response.

## [0.1.2] - 2026-06-28

### Fixed

- Republished with npm-compatible metadata so the registry package page receives
  the README content.

## [0.1.1] - 2026-06-28

### Added

- Report generation and optional delivery through Open Mailery email, Open
  Telephony SMS, and Open Logs structured logs.
- `uptime report`, `GET /api/report`, `POST /api/report`,
  `uptime_send_report`, and SDK report helpers.

### Fixed

- Prevented stale in-flight checks from overwriting monitor updates, target
  changes, or pauses.
- Closed existing open incidents when a monitor target is changed, without
  marking the old target as recovered by the new target.
- Added SQLite-backed check leases to avoid duplicate due checks across
  multiple service instances sharing one database.
- Rejected non-boolean `enabled` values at the SDK/API boundary.
- Counted all open incidents in summaries instead of using the paginated
  incident-list cap.
- Rejected control characters in monitor names and TCP hosts, and sanitized
  human CLI output for legacy stored values.
- Rejected state-changing API requests for non-loopback Host values unless a
  configured API token or explicit unsafe mode is used.

## [0.1.0] - 2026-06-28

### Added

- Initial local-first uptime and downtime monitoring service.
- HTTP/HTTPS and TCP monitors with interval, timeout, retry, pause, and resume
  settings.
- SQLite persistence under `~/.hasna/uptime/`, with `HASNA_UPTIME_HOME` and
  `HASNA_UPTIME_DB` overrides.
- Incident open/close lifecycle, recent result history, check-count uptime
  summaries, and latency summaries.
- CLI, SDK, MCP server, local API, and dashboard surfaces.
- Local API same-origin mutation guard and JSON content-type enforcement.
- Apache-2.0 OSS baseline files: license, notice, security policy,
  contribution guide, and code of conduct.
