# Changelog

All notable changes to `@hasna/calendar` are documented here.

## 0.2.5 — main<->npm reconciliation

- **Reconcile `main` with the published npm line.** `main` had drifted to `0.1.16`
  while npm `latest` was `0.2.4`, meaning the deployed/published code was not on `main`.
  `main` had zero unique commits and was strictly behind the published tag
  `npm/calendar/v0.2.4` by 7 commits, so the published line was merged onto `main`
  with no lost history. Version is bumped to `0.2.5` (above the published `0.2.4`) so
  the next publish supersedes what is on the registry.
- No functional/source changes in this release beyond the version bump; it exists to
  land the already-published `0.2.x` work onto `main` and re-establish `main` as the
  source of truth for the deployed line.

### Included from the reconciled 0.2.x line (previously published, now on `main`)

- refactor(calendar): route CLI/MCP/SDK through one unified Store (LocalStore + ApiStore).
- fix(calendar): remove sqlite/db re-exports and mode-alias shim from client.
- fix(mcp): route org/calendar/event tools to cloud `/v1` in self_hosted mode.
- fix(calendar): sanitize FTS5 search + robust cloud attendee update.
- self_hosted cloud `/v1` route fixes for agents/attendees/availability/members.
- release bumps for 0.2.1 / 0.2.3 / 0.2.4.
