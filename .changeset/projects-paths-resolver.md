---
"@hasna/projects": patch
---

Switch @hasna/projects local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout): the projects home (`getProjectsHome`) and the default registry DB path (`getDbPath`, derived from the home) now resolve through `dataDir({ app: "projects" })`. The legacy `~/.hasna/projects` home (with the `HASNA_PROJECTS_HOME` / `HASNA_PROJECTS_DB_PATH` / `HASNA_WORKSPACES_DB_PATH` exact-app overrides) stays the effective home until the store has actually been migrated to the XDG data home (`projects.db` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.2` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
