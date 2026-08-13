# Changesets

This monorepo uses changesets with **independent** per-package versions
(`fixed: []` in `config.json` — every member package versions on its own cadence,
never in lockstep). Publishing is `access: "public"`: every member package is a
public `@hasna/*` package.

How it works:

- Every change that affects a published package's consumers carries a changeset:
  `bunx changeset` (follow the prompts; package + bump level + summary).
- `bunx changeset version` bumps versions and rewrites changelogs from the
  pending changesets, in a worktree + PR like any other change.
- Publishing is per-package `npm publish` from each package directory — see
  `.claude/rules/publish.md`. `bun publish` has no workspace filter and the
  changesets+bun `workspace:*` tarball leak defect is why the fleet publishes
  per-package with npm.

The changesets are informational. The only version/versioning source of truth is
each package's own `package.json` after `changeset version` runs.
