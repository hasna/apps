---
"@hasna/servers": patch
---

Switch @hasna/servers local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The default SQLite database path (`src/db/database.ts` fallback) now resolves from the effective data root: the resolver data home (`~/.local/share/hasna/servers` on Linux, `~/Library/Application Support/Hasna/servers` on macOS) is adopted only when the operator sets the data-kind override `HASNA_DATA_HOME` or the store has already been physically migrated there — the legacy `~/.hasna/servers` root stays the effective data home until then, so an existing local store never becomes invisible on upgrade. The pre-existing `SERVERS_DB_PATH` store override and the per-project `.servers/servers.db` discovery keep their precedence above the default. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
