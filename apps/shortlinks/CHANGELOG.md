# Changelog

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
