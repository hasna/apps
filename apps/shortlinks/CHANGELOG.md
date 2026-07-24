# Changelog

## 0.2.6

- chore(reconcile): reconcile `main` to the published npm line. `main` had
  fallen 7 commits behind the published release tag `npm/shortlinks/v0.2.5`
  (npm dist-tag `latest` = 0.2.5); the deployed/published code was never merged
  back to `main`. `main` was a strict ancestor of the tag (0 commits ahead), so
  the published work (`5003522`..`bdf5556`) was merged back non-destructively —
  no `main` commits lost, no force-push. Version bumped above the published
  line (published tag's package.json read 0.2.4 vs dist-tag 0.2.5 — a
  bump-vs-tag mismatch upstream; skipping 0.2.5 to avoid reuse).

## 0.2.1

- fix(mcp): remove the unpublished `@hasna/mcp-harness` (`file:../open-mcp`)
  dependency that made `shortlinks-mcp` unstartable on a fresh install. The MCP
  HTTP transport is now self-contained (published `@modelcontextprotocol/sdk` +
  Bun.serve), matching the reference apps.
- feat(domains): add domain deletion end-to-end — `shortlinks domain remove`
  CLI command, `delete_domain` MCP tool, `Store.deleteDomain`, and
  `DELETE /v1/domains/:hostname` API endpoint (cascades links + clicks).
  Requires an ECS redeploy of the self-hosted server for the new route.
- chore(deps): depend on the published `@hasna/contracts` instead of a `file:`
  link so `bun install` / `npm i` resolve cleanly.

## 0.1.0

- Initial CLI-only shortlinks package.
