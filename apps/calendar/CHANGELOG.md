# Changelog

## 0.2.5

Reconcile `main` with the published npm line (`@hasna/calendar@0.2.4`).

`main` had diverged into a true three-way split from the published registry line:

- **Published-only (7 commits, npm `latest` 0.2.4):** the self_hosted unified-`Store`
  refactor (`getStore()` → `LocalStore` + `ApiStore`), cloud `/v1` route fixes
  (agents/attendees/availability/members), FTS5 search sanitize, removal of the
  sqlite/db re-exports + mode-alias shim, and release bumps for 0.2.1/0.2.3/0.2.4.
- **main-only (2 commits):** `#1` report the MCP server version from `package.json`,
  and `#2` compact CLI + MCP list output (paged, `--verbose`/`limit`/`cursor`).

This release merges the published tag into `main` with a `--no-ff` merge (both
histories preserved — no commits dropped) and re-applies the two main-only features
on top of the published `Store` architecture rather than text-merging them:

- **`#1` MCP version** is preserved as-is (the MCP server already reads
  `packageJson.version`).
- **`#2` compact output** now sources its data through `getStore()` (async, transport
  -routed) while keeping the compact/paged presentation (`outputList` in the CLI,
  `compactPage`/`pageArgsSchema` in the MCP server). The `compact*` helper type
  annotations were repointed from the removed direct DB functions to the shared entity
  types (`Org`, `Agent`, `Calendar`, `Event`, `EventAttendee`, `Availability`,
  `OrgMembership`).
- **`#1` release-bin health test** now polls the published server's canonical
  service-contract endpoint `/health` (the legacy `/api/health` alias was removed by
  the `Store` refactor).

Version bumped to `0.2.5` (above the published `0.2.4`) so the next publish supersedes
the registry.

### Verification

`bun install` / `bun run typecheck` / `bun run build` all pass; `bun test` passes
`123/123` in local mode. The 11 remaining failures seen when the station's
`HASNA_CALENDAR_STORAGE_MODE=cloud` env is present are pre-existing test-isolation
gaps (the CLI/MCP subprocess harness inherits the live cloud config instead of
forcing local mode) — they pass once the `HASNA_CALENDAR_*` env is unset, and are
not introduced by this reconciliation.
