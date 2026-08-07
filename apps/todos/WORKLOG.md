# Work Log

Append-only record of material repository work. Each entry includes a timestamp,
agent identity, task reference, evidence, and next action. Never record secrets.

## 2026-08-07

### 2026-08-07T12:47:21+03:00 — Quintilian implementation sub-agent

- Task: `f6ccf7d5-9d97-4e1d-b1b6-3de273b56616`; source task:
  `e2546cbc-489c-44a1-9a91-7994abf0382f`.
- Created the isolated worktree on `fix/f6ccf7d5-task-list-resolution` from
  current `origin/main` (`912706df`).
- Verification: `repos worktree add`, `repos scan`, and clean worktree status
  all returned `rc=0`.
- Next: reproduce the task-list UUID and scoped-slug failures, then add the
  narrowest failing regression before production changes.

### 2026-08-07T12:51:22+03:00 — Quintilian implementation sub-agent

- Task: `f6ccf7d5-9d97-4e1d-b1b6-3de273b56616`.
- Confirmed the production-shaped cause: the Swiss task list is globally stored
  with `project_id: null`, while its project owns the same canonical slug in
  `project.task_list_id`; the cloud resolver filters by project before matching.
- Verification: the new focused regression returned `rc=1` with literal output
  `0 pass`, `2 fail`, covering exact UUID and project canonical slug.
- Next: teach the shared cloud resolver to validate the canonical legacy
  project/list link without allowing cross-project UUID attachment.

### 2026-08-07T12:54:35+03:00 — Quintilian implementation sub-agent

- Task: `f6ccf7d5-9d97-4e1d-b1b6-3de273b56616`.
- Updated the shared cloud task-list resolver to follow only the explicit
  `project.task_list_id === task_list.slug` legacy ownership link, with a
  negative control that rejects unrelated global lists.
- Verification: resolver file `94 pass, 0 fail`; cloud CLI list-routing file
  `33 pass, 0 fail`; TypeScript gate `rc=0`.
- Real acceptance: the worktree CLI updated source task
  `e2546cbc-489c-44a1-9a91-7994abf0382f` by both the exact UUID and canonical
  slug at `rc=0`; final `task_list_id` is
  `09dc7e1d-7c20-4a52-b4fb-7675d7202f90`.
- Next: run full repository tests/build, staged secret scan, commit, push, and
  open the unmerged review PR.

### 2026-08-07T13:12:29+03:00 — Quintilian implementation sub-agent

- Task: `f6ccf7d5-9d97-4e1d-b1b6-3de273b56616`.
- Repository validation passed: full suite `3433 pass, 0 fail` across 267
  files; no-cloud boundary `36 pass, 0 fail`; typecheck and production build
  both returned `rc=0`.
- Acceptance remains live: source task
  `e2546cbc-489c-44a1-9a91-7994abf0382f` resolves and stores the Swiss task-list
  UUID through both exact UUID and canonical-slug inputs.
- Next: stage the exact candidate, run `shield review`, commit with the required
  `Agent: Quintilian` trailer, push, and open the unmerged pull request.

### 2026-08-07T21:52:28+03:00 — Theophrastus implementation sub-agent

- Task: `409db44f-3300-4774-a001-602ff5443d64`; added guarded existing-plan
  project linkage across SQLite and PostgreSQL storage, authenticated v1 HTTP,
  generated SDK, and local/cloud CLI paths.
- The apply path uses exact plan, project, and sorted member-task revisions;
  immutable idempotent receipts and conditional rollback preserve prior links,
  while future plan members inherit the authoritative project and conflicting
  membership writes fail closed.
- Verification: focused linkage/storage/HTTP/OpenAPI/CLI gate `130 pass, 0
  fail`; typecheck `rc=0`; production build and no-cloud boundary `rc=0`.
  The full repository suite reported `3497 pass, 50 skip, 1 fail`; its sole
  failure is the separately tracked ambient `/tmp/node_modules` server-bundle
  resolver defect, not a changed linkage lane.
- Test isolation was repaired to use an explicit in-memory database. Incident
  `679082` preserved a redacted exact fixture snapshot in task comment
  `e1b0546b-ff69-492c-b4cb-acea95d8dd8f`; the 12 station02-local fixture
  objects were removed through supported CLI commands, all negative readbacks
  passed, and unrelated local plus hosted Dubai controls remained present.
- Next: stage the exact candidate, run `shield review`, commit once with the
  required `Agent: Theophrastus` trailer, push, and open the draft pull request.
