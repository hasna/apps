# Worktree + PR-first

Every file mutation in this repo happens in a task-specific worktree under the
canonical root `$HOME/.hasna/repos/worktrees/apps/<worktree-name>` on a unique
branch cut from `origin/main` (or the branch you are stacking on — say so in
the PR description). Create it with the sanctioned verb — it computes the
canonical path and claims a lease. Never hand-create a worktree path, and never
hand-roll `git worktree add`:

```bash
repos worktree add apps --name <worktree-name> --branch <branch> --base origin/main
```

`--task <todos-id>` replaces `--name` when a todos task exists. The base is
pinned from a freshly fetched `origin`, never `HEAD`:

```text
$HOME/.hasna/repos/worktrees/apps/<worktree-name>            # what the installed CLI computes today
$HOME/.hasna/repos/worktrees/hasna/apps/<worktree-name>      # canonical target, once the CLI accepts an org segment
```

- Never mutate the shared checkout. Never push to `main` — no exceptions.
  (The repo's initial `main` commit, 2026-08-13, is the owner-approved
  bootstrap and the ONLY direct-main push this repo will ever have.)
- Land via PR (`gh pr create`); `bun run check` + affected build/test must pass
  before merge.
- One logical change per PR; PR body ends with the `Agent: <name>` trailer.
- Remove the worktree when the PR lands — `repos worktree remove apps/<worktree-name>`
  (never by path; the lease id is printed by `repos worktree add`), tracked by a
  disposal record per the experiment-artefact lifecycle rule when the worktree is
  not a plain landed-PR worktree.
