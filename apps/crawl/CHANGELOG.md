# @hasna/crawl

## 0.4.20

### Patch Changes

- Republication past the registry-protected 0.4.19 slot: 0.4.19 was published 2026-08-27 and the package was subsequently fully unpublished, so its npm slot is permanently burned (npm never allows reusing a published version). 0.4.20 carries the identical reviewed 0.4.19 content — the paths-resolver XDG migration and the release-review security/correctness fixes recorded in the 0.4.19 entry below.

## 0.4.19

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG home migration, hotfixes plan 0f49f56a, task P3.3). The legacy `~/.hasna/crawl` data root (with `HASNA_CRAWL_HOME` / `CRAWL_HOME` exact-app overrides and the existing `HASNA_CRAWL_DB_PATH` / `CRAWL_DB_PATH` store overrides) stays the effective data root until the store is physically migrated to the XDG data home (`data.db` present there) or the operator sets `HASNA_DATA_HOME`. The legacy `~/.open-crawl` / `~/.crawl` auto-migration now targets the effective data root. Dependency pinned exactly to `@hasna/paths@0.1.0`.
- Release-review fixes: when `HASNA_DATA_HOME` (or an exact override) redirects the effective root, the legacy `~/.hasna/crawl` store is also imported by the auto-migration so a live store never becomes invisible on upgrade; a blank/whitespace-only `HASNA_CRAWL_HOME` now falls through to `CRAWL_HOME` instead of silently selecting the default root; and a legacy source is never copied into itself or its own descendant (an exact override nested inside a legacy root no longer recurses).
- Release-review fixes (security): `crawl open <page-id>` now launches the system browser without a shell — the stored, crawler-controlled page URL travels as an argv element to a non-shell launcher (`open` / `explorer` / `xdg-open`) and non-http(s) URLs are refused outright, closing a command-injection vector; the dashboard escapes every crawler-controlled field (page titles decoded from HTML entities, URLs, snippets) before rendering it into `innerHTML`, closing a stored-XSS vector.
- Release-review fixes (correctness): `POST /v1/crawls` (async) and `POST /v1/batch` now return the crawl record id that actually performs the work — the background worker runs under the pre-created record, so the returned id transitions `pending -> running -> completed` instead of staying `pending` forever while an unreturned id did the crawling.

## 0.4.18

### Patch Changes

- 8b70821: crawl-mcp and crawl-serve answer --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `crawl-mcp --version`/`--help` started the crawl HTTP server (:8857) and `crawl-serve --version`/`--help` bound :19700 — both printed the server bind banner instead of answering the flag.
