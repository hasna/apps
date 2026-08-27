# @hasna/crawl

## 0.4.19

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG home migration, hotfixes plan 0f49f56a, task P3.3). The legacy `~/.hasna/crawl` data root (with `HASNA_CRAWL_HOME` / `CRAWL_HOME` exact-app overrides and the existing `HASNA_CRAWL_DB_PATH` / `CRAWL_DB_PATH` store overrides) stays the effective data root until the store is physically migrated to the XDG data home (`data.db` present there) or the operator sets `HASNA_DATA_HOME`. The legacy `~/.open-crawl` / `~/.crawl` auto-migration now targets the effective data root. Dependency pinned exactly to `@hasna/paths@0.1.0`.
- Release-review fixes: when `HASNA_DATA_HOME` (or an exact override) redirects the effective root, the legacy `~/.hasna/crawl` store is also imported by the auto-migration so a live store never becomes invisible on upgrade; and a blank/whitespace-only `HASNA_CRAWL_HOME` now falls through to `CRAWL_HOME` instead of silently selecting the default root.

## 0.4.18

### Patch Changes

- 8b70821: crawl-mcp and crawl-serve answer --version/-V/--help before any bind (todos row 7e5f8f3d). Previously `crawl-mcp --version`/`--help` started the crawl HTTP server (:8857) and `crawl-serve --version`/`--help` bound :19700 — both printed the server bind banner instead of answering the flag.
