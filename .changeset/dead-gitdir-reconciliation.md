---
"@hasna/repos": patch
---

Worktree reconciliation handles dead gitdir pointers: `repos worktree list` names them with a `dead-gitdir` issue class (shape-valid `.git` pointers whose target gitdir is gone after a parent-checkout move — measured at ~1,600 of ~2,000 entries under the live root after the 2026-08-14 monorepo move); `repos worktree remove` refuses them with `WORKTREE_DEAD_GITDIR` instead of reading every git guard as clean, classifying the worktree as landed-detached and failing at `git worktree remove` with an opaque `GIT_FAILED`; the new `--allow-dead-gitdir` flag archives the whole working tree (with a manifest and the dead pointer) before removing the directory, bypassing git because git cannot open it; `repos worktree adopt` refuses a dead-gitdir path and reports dead candidates as `skipped` in `--all` mode instead of leasing a worktree git can never verify.
