---
"@hasna/repos": patch
---

Switch @hasna/repos local path reads/writes through the in-package resolver (XDG/macOS home layout). The legacy `~/.hasna/repos` data root (with the `HASNA_REPOS_HOME` exact-app override, and the existing `HASNA_REPOS_CONFIG_PATH`, `HASNA_REPOS_DB_PATH` / `REPOS_DB_PATH`, `HASNA_REPOS_HOOK_QUEUE_PATH`, and `HASNA_REPOS_GITHUB_CACHE_PATH` file-level overrides layered on top) stays the effective data root until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The worktree and clones roots (`~/.hasna/repos/worktrees`, `~/.hasna/repos/clones`) stay code-derived from the OS account home for containment; making them configurable is tracked separately (hotfixes plan 0f49f56a, task P5.1). The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
