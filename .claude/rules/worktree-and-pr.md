# Worktree + PR-first

Every file mutation in this repo happens in a task-specific worktree under the
canonical root `$HOME/.hasna/repos/worktrees/apps/<worktree-name>` on a unique
branch cut from `origin/main` (or the branch you are stacking on — say so in
the PR description):

```bash
git -C "$HOME/.hasna/repos/worktrees/apps/skeleton" fetch origin
git -C "$HOME/.hasna/repos/worktrees/apps/skeleton" worktree add \
  "$HOME/.hasna/repos/worktrees/apps/<name>" -b <branch> origin/main
```

- Never mutate the shared checkout. Never push to `main` — no exceptions.
  (The repo's initial `main` commit, 2026-08-13, is the owner-approved
  bootstrap and the ONLY direct-main push this repo will ever have.)
- Land via PR (`gh pr create`); `bun run check` + affected build/test must pass
  before merge.
- One logical change per PR; PR body ends with the `Agent: <name>` trailer.
- Remove the worktree when the PR lands (`git worktree remove <path>` from the
  main checkout), tracked by a disposal record per the experiment-artefact
  lifecycle rule when the worktree is not a plain landed-PR worktree.
