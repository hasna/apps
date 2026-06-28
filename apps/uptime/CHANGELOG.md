# Changelog

All notable changes to `@hasna/uptime` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
