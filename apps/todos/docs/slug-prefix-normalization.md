# Slug-prefix normalization — migration spec

This is the spec for the SEPARATE, reviewed migration that renames every hosted
project whose slug carries the legacy auto-added `todos-` prefix. The code
change that stops auto-adding the prefix ships in its own PR
(`fix(todos): no auto 'todos-' slug prefix + normalization plan`); this
document is that PR's migration specification and MUST be executed as its own
reviewed run. It is shipped here so the plan is reviewed together with the
code change, not written afterwards.

## 1. Why

`hasna/todos` auto-derived a project's slug from its name as `todos-<slug>`.
That derivation is removed: user-given slugs stay verbatim (lowercase/kebab
sanitization only). All projects created before the removal carry the prefix
and must be renamed to the unprefixed slug so the fleet converges on one slug
shape.

## 2. Measured population (hosted authority, todos.hasna.xyz)

Taken read-only via the installed CLI (`todos projects --json`), 2026-08-14:

| metric | count |
|---|---|
| total projects | 2816 |
| prefixed (`todos-*`) | 2636 |
| collision-free renames | 2617 |
| collisions (unprefixed slug already exists) | 19 |
| empty-after-strip / duplicate candidates | 0 |

## 3. Mechanism

`todos project-rename <id-or-slug> <new-slug>` (works against the hosted
authority). The server-side rename is atomic, collision-checked (project slug
conflict, task-list slug conflict), and cascades to the project's task lists.
Tasks keep their stable `project_id` UUID and are untouched.

Per project: `todos project-rename todos-<slug> <slug>`.

## 4. Collision resolutions (19)

For each collision the unprefixed slug is already held by an existing row. Each
prefixed row below must be reconciled per its resolution; the migration runner
(operator) confirms each resolution at run time. Nothing is deleted; tasks are
never dropped.

| prefixed slug (to rename away) | existing holder of unprefixed slug | observed pair | resolution |
|---|---|---|---|
| `todos-platform-codewith` | `platform-codewith` (`Codewith`, workspace checkout) | prefixed row is `[ARCHIVED] platform-codewith` at a global node_modules path | **archive-keep**: rename to `platform-codewith-archived` (or delete row after task migration if empty); do not take the live slug |
| `todos-iapp-digital` | `iapp-digital` (workspace path, case variant) | duplicate rows for the same workspace (`Workspace` vs `workspace`) | **merge**: migrate prefixed row's tasks into the canonical unprefixed row, then archive the prefixed row |
| `todos-iapp-leads` | `iapp-leads` | duplicate rows for the same workspace | **merge** (as above) |
| `todos-iapp-sms` | `iapp-sms` | duplicate rows for the same workspace | **merge** (as above) |
| `todos-loops` | `loops` (`Loops`, station01 path) | mac-vs-station row for the same loops workspace | **merge** (as above) |
| `todos-open-bridge` | `open-bridge` (`@hasna/bridge`) | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-changelog` | `open-changelog` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-computer` | `open-computer` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-deployment` | `open-deployment` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-gateway` | `open-gateway` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-identities` | `open-identities` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-logs` | `open-logs` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-researcher` | `open-researcher` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-open-signatures` | `open-signatures` | prefixed row is the opensource repo; holder row points at `iapp-signatures` | **confirm-holder-then-merge**: verify which row is canonical for `open-signatures`; rename the loser away (`-archived`) and merge tasks into the winner |
| `todos-open-testers` | `open-testers` | mac-vs-station row for the same repo | **merge** (as above) |
| `todos-platform-pawk` | `platform-pawk` (`Pawk`) | prefixed row (`Platform Pawk`, hasnatools root) vs studio checkout | **merge** (as above) |
| `todos-platform-mailery` | `platform-mailery` | duplicate rows for the same checkout | **merge** (as above) |
| `todos-platform-mcps` | `platform-mcps` | duplicate rows for the same checkout | **merge** (as above) |
| `todos-platform-p2w` | `platform-p2w` (`P2w`) | mac-vs-station row for the same repo | **merge** (as above) |

Merge procedure per row (operator-confirmed, data-preserving):

1. List the prefixed row's tasks (`todos list --project <id>`); confirm the
   holder row has no duplicate task ids (ids are UUIDs — no overlap expected).
2. Re-parent each task to the holder project (`todos move <id> --to-project
   <holder-id>`, or the supported batch path) — or confirm the prefixed row is
   empty.
3. Rename the prefixed row away from the collision: `todos project-rename
   todos-<slug> <slug>-archived` (or `-merged`), keeping history intact.
4. Record the before/after id+slug pair in the migration log.

## 5. The 2617 collision-free renames

Each is a plain `todos project-rename todos-<slug> <slug>`, executed by the
included script in batches with per-rename verification (`todos projects
--show <new-slug>` resolves, old slug 404s or resolves to nothing).

## 6. Sequence and gates

1. Dry-run pass (script default): enumerate, compute renames, print plan, exit
   0 with zero mutations. Verify the plan matches this document's numbers.
2. Adversarial review of THIS spec + the script before `--apply`.
3. Apply pass: `bun run scripts/normalize-slug-prefixes.ts --apply` — gated:
   refuses to rename when the target slug exists unless an explicit resolution
   row for that collision is present (the 19 above are pre-seeded in the
   script's resolution table, keyed by prefixed slug).
4. Verify pass: re-enumerate; expect 0 prefixed slugs, unchanged total count,
   and per-rename receipts in the run log.
5. Announce the migration (`[BREAKING]` to `announcements` + publish-intent
   style record) before the apply pass, since slugs are referenced by agents.

## 7. Rollback

Every rename is individually reversible with `todos project-rename <slug>
todos-<slug>` (collision-checked — a later unprefixed creation would block the
reverse rename; the rollback renames back before any such creation). The
migration log records every before/after pair. No data is deleted by this
migration; merges (section 4) are the only non-rename operations and are
individually reversible by moving tasks back.

## 8. What this migration does NOT do

- It does not delete projects or tasks.
- It does not change task prefixes (`APP-00001` style) — project-rename
  explicitly leaves them unchanged.
- It does not touch local SQLite stores; local stores converge through the
  normal sync path and their own `task_list_id` values are updated by the same
  `project-rename` verb when run locally.
