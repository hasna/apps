# Changelog

## 0.7.0

- **Breaking (pre-1.0 minor):** CLI, MCP, SDK and package-root data operations require an explicitly configured authenticated HTTPS authority. Missing credentials, retired storage selectors and client database URLs fail closed; there is no automatic local SQLite fallback.
- PostgreSQL remains server-only. Isolated CI verifies the actual schema twice and production contact creation, retrieval, email-only updates, deletion and child cascade against PostgreSQL16, with a mandatory missing-configuration negative control.
- Explicit legacy-data preservation copies and verifies source/output bytes without selecting, deleting or moving existing local data. Credential binding and HTTPS redirect refusal remain enforced across public client surfaces.
- Includes the prior monorepo fold. Existing vendored storage-kit provenance is unchanged; this release does not claim regeneration with a newer Contracts kit or deployment/migration of user data.

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
