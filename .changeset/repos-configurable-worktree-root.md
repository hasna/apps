---
"@hasna/repos": patch
---

Make the worktree and clones roots configurable through the resolver (hotfixes plan 0f49f56a, task P5.1 / 7b8fc186). `worktreeRootDir()`, `clonesRootDir()`, and the primary-relocation canonical root now derive from `getDataRootForHome`, so `HASNA_REPOS_HOME`, an adopted `HASNA_DATA_HOME`, or a physically migrated store moves the worktrees (`<data-root>/worktrees`) and clones (`<data-root>/clones`) with the data. The account-database base is retained for the default legacy case, so a forged `$HOME` alone still cannot move the root — only the documented resolver overrides can. This unblocks migrating `~/.hasna/repos` to `~/.local/share/hasna/repos`: `repos worktree list <repo>` now resolves under the effective data root instead of the hardcoded `~/.hasna/repos/worktrees`.
