---
"@hasna/todos": patch
---

Project and task-list slugs are no longer auto-prefixed with `todos-`. A new
project registered from the name `apps` now derives the bare slug `apps`
(previously `todos-apps`); task lists follow the same rule, matching the fleet
convention that a repo project's task-list slug IS the repo short name.

- New projects/task lists: `task_list_id`/`slug` = the sanitized kebab-case
  name, verbatim — no prefix is prepended (SQLite, Postgres, and the
  project-registration authority all agree; v1 `/projects` and `/task-lists`
  derive the same way).
- Explicit user-supplied slugs are stored verbatim, so a deliberate
  `todos-<name>` id is still honored.
- Legacy stored ids are untouched (no rows renamed) and keep resolving by
  their stored value, including the registration authority's bind of
  pre-normalization `todos-<slug>` rows. Duplicate names still fail with
  `PROJECT_SLUG_CONFLICT`; the collision surface for the hosted fleet's
  existing prefixed rows is planned in `apps/todos/docs/slug-prefix-
  normalization.md` (runner: `apps/todos/scripts/normalize-slug-prefixes.ts`,
  dry-run by default, case-seeded collision resolutions, separate reviewed
  run).