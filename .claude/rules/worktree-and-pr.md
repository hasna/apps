# Worktree + PR-first

Every file mutation in this repo happens in a task-specific worktree under the
canonical root `$HOME/.hasna/repos/worktrees/apps/<worktree-name>` on a unique
branch cut from `origin/main` (or the branch you are stacking on — say so in
the PR description):

```bash
repos worktree add apps --name <name> --branch <branch> --base origin/main
```

The `repos worktree` verb is the creation path: it pins the base from a freshly
fetched `origin` and records the lease. **Never `git worktree add` by hand.**

- Never mutate the shared checkout. Never push to `main` — no exceptions.
  (The repo's initial `main` commit, 2026-08-13, is the owner-approved
  bootstrap and the ONLY direct-main push this repo will ever have.)
- Land via PR (`gh pr create`); `bun run check` + affected build/test must pass
  before merge.
- One logical change per PR; PR body ends with the `Agent: <name>` trailer.
- Remove the worktree when the PR lands (`repos worktree remove apps/<name>`),
  tracked by a disposal record per the experiment-artefact lifecycle rule when
  the worktree is not a plain landed-PR worktree.
