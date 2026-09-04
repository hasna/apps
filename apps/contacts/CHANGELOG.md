# Changelog

## Unreleased

- CI: run install, typecheck, build, and tests on pull requests and pushes to `main`

## 0.6.36 — 2026-08-30

- Folded into the hasna/apps monorepo as `@hasna/contacts` (CLI, MCP, serve, SDK surfaces); version matches the npm-published 0.6.36. The standalone github.com/hasna/contacts repo is retired.

## 0.1.0 — 2026-03-20

Initial release.

- CLI: `contacts` command with add/list/show/edit/delete/search/import/export
- MCP server: 24 tools for AI agents
- SQLite storage with FTS5 full-text search
- Import/Export: CSV, vCard, JSON
