# Changelog

All notable changes to `@hasna/uptime` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
