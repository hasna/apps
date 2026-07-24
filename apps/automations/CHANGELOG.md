# Changelog

All notable changes to `@hasna/automations` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-24

Release cutting the work merged to `main` after `0.1.3` (PR-drain).

### Added
- Launch follow-up recipe pack: T+1/3/7 engagement, Mailery enrollment, and
  uptime watch-window automations, exposed via `automations recipes list` and
  `automations recipes render launch-followup` (#1).
- Run receipts now emit `@hasna/contracts` conformant payloads; `runs list`
  and `runs show` accept a `--contract` flag (#5).
- Release webhook smoke checklist and `smoke:webhook-release` script (#7).

### Fixed
- Removed a duplicate CLI entry from the packaged bundle (#6).

### Docs
- Reconciled the automations package plan and canonical repository metadata (#2, #8).

## [0.1.3] - 2026-06-29

- Prior published baseline.
