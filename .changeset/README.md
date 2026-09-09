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

## Bump class — every member is 0.x, so `minor` is the breaking class

Declare a consumer-breaking change (`minor`), never `patch`: a moved or removed
command/export, a removed config surface, or a changed credential/storage
default. `patch` is what the tooling would mis-bump, and a mis-declared
changeset only surfaces at the next `changeset version` run.

Precedent (measured, 2026-09-09): the 18 `@hasna/todos` changesets consumed into
the 0.16.0 section (`3e3c645cd`) were all declared `patch` while carrying the
`plans`/`task-lists`/`templates` API-only conversion and the credential-resolver
change. 0.16.0 — a minor — is the class that covers them; they were hand-consumed
into the already-cut 0.16.0 section rather than run through `changeset version` at
0.15.52, which would have produced a 0.15.53 `patch` bump for a breaking change.
See `release-review-todos.md` §1. (Consumption is committed at worktree HEAD
`85e3a8287`; at the `release/todos-0.16.0` vehicle `3e63609f9` all 18 are still
pending — the disposition is conditional on that push, per §1's round-3 note.)

## Naming a package that is not in the workspace

Changesets parses the frontmatter only; prose in the body is never resolved. A
frontmatter entry for a package that is not a workspace member is a hard error
(`Found changeset <file> for package <name> which is not in the workspace`,
`changeset version` exit 1); a stale package name in the body is only a
documentation defect. Do not delete another member's changeset to fix prose —
rewrite the reference in that member's next changeset. See
`release-review-todos.md` §2.
