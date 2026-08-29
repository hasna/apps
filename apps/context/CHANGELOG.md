# Changelog

## Unreleased

- Run typechecking, builds, and tests in GitHub Actions for pushes and pull requests.

## 0.1.54

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/context` data home (with the `HASNA_CONTEXT_DATA_DIR` / `CONTEXT_DATA_DIR` exact-app overrides layered on top of the existing `HASNA_CONTEXT_DB_PATH` / `CONTEXT_DB_PATH` store overrides) stays the effective data home until the store has been migrated to the XDG data home or the operator sets `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The legacy `~/.hasna/context` store itself is now a migration source: when `HASNA_DATA_HOME` adopts the XDG data home, the existing store is snapshotted into the effective home instead of leaving the upgrade opening an empty database. The snapshot uses SQLite's atomic `VACUUM INTO` on a read-only handle (single-file, transactionally consistent — including uncheckpointed WAL content), so a live legacy database can never lose committed rows to a checkpoint racing the copy; the copy is verified, receipted, and the legacy store is never deleted. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Full-text search on the hosted PostgreSQL backend (FTS5 parity): migration 15 adds generated `tsvector` columns + GIN indexes (`chunks.content_tsv`, `libraries.search_tsv`) and `PgAdapterAsync` gains `searchChunks` / `searchLibraries` with prefix-query semantics and an ILIKE substring fallback for libraries. Server-side search now applies the PostgreSQL migrations itself before the first hosted query (previously only `context storage push|pull|sync` did), so a fresh or pre-migration database is migrated automatically — and hosted search failures now propagate to the caller (HTTP 500) instead of returning HTTP 200 with no matches while stored results exist.
- Public server/auth behavior: the HTTP surface (`context-serve`) answers `/health`, `/ready` and `/version` publicly; `/api/*` routes require HTTP auth when `CONTEXT_HTTP_TOKEN` / `HASNA_CONTEXT_HTTP_TOKEN` is set or `CONTEXT_REQUIRE_HTTP_AUTH` / `HASNA_CONTEXT_REQUIRE_HTTP_AUTH` is enabled (Bearer or `x-context-token`), with constant-time token comparison. The HTTP surface now also serves its OpenAPI 3.1 contract at `/openapi.json` (public), `hasna.contract.json` declares it (`openApiPath` / `generatedFrom`), and the package SDK ships a typed HTTP client (`ContextClient`, exported from the package root) that is generated from that OpenAPI document (`bun run openapi:generate`, staleness-gated by a test) and can invoke every declared route — including `/api/context/build`, `/api/verify`, `/api/webhooks/*` and `/mcp`.
- Display name "Hasna Context" (the open- prefix convention was retired) and the canonical data root `~/.hasna/context` (commit 73174e917) are part of this release delta.

## 0.1.53

- Publish previously-merged work from the PR drain (npm `latest` was stuck at 0.1.52 from
  2026-06-29 while `main` had since advanced).
- Add v2 context hub contracts (#1): v2 storage, query pipeline, open-knowledge adapter,
  types, Postgres migrations, and architecture docs.
