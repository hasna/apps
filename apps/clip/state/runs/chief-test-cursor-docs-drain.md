# Open Clip Docs Drain Evidence

Task: `3e76d8ab-d3b7-4883-8e5f-3c22af5ef516`
Updated: 2026-07-07

## Proof Runs

- Proof task `bf5c3321` is recorded complete in Todos with PR
  `https://github.com/hasna/clip/pull/1`, squash-merged as
  `451cb1dea38cc39a192dac9b70d7f37f840b89c9`.
- Proof task `37862274` is recorded complete in Todos with PR
  `https://github.com/hasna/clip/pull/2`, squash-merged as
  `c180ab6c786de510d4da409de0f8500fd3a7b6d7`.

## Retired Proof Loop

The original session-bound proof path was the paused OpenLoops loop
`019f2d693d68c37e0ad22dca383cb447`
(`machine-chief-docs-drain-clip`). It was a Cursor agent loop with prompt source
`/home/hasna/workspace/hasnaxyz/agent/agent-chief-of-staff/state/runs/chief-docs-drain-clip.prompt.md`
and is intentionally paused after proving worker -> PR -> adversarial review ->
squash-merge behavior.

## Durable Intake

The durable replacement is OpenLoops loop
`019f3ce59623ba6c7e153bd4925723a6`
(`machine-drain-pr-docs-drain-v2`), active on spark01 with cadence `every:5m`.
Its command drains
`/home/hasna/.hasna/projects/drain-pr-docs-drain` for `auto:route` todos and
creates provider-native `task-lifecycle` workflow runs with:

- `--worktree-mode required`
- `--worktree-root /home/hasna/.hasna/loops/worktrees`
- `--worktree-branch-prefix drain-pr-docs-drain`
- `--pr-handoff`
- `--github-reviewer-pool andrei-hasna,kriptoburak`
- `--provider codewith`
- account pool `account006,account009,account007,account008,account010,account012,account013,account014`
- route throttles `--max-dispatch 1`, `--max-active 1`,
  `--max-active-per-project 1`, and `--max-active-per-project-group 2`

Evidence directory:
`/home/hasna/.hasna/loops/reports/todos-task-drain/drain-pr-docs-drain`.

The 2026-07-07 drain report
`todos-task-drain-20260707T144509124Z-fdca483c.json` scanned one eligible task,
created one workflow, and recorded `fatal: 0`. It admitted this task as
work item `019f2dd96ec422b206bd98c326451c3c`, workflow
`019f3d0a3d7fe8cf4d536ff61977b69c`, one-shot run loop
`019f3d0a3d8094795681c2c161df5867`, with triage on `account013`, planner on
`account012`, worker on `account007`, and verifier on `account010`.

## Worker Assessment

No synthetic docs task was introduced. The durable intake path is already
session-independent and routed this task through the required worktree and
provider-native lifecycle. The task should remain open for the independent
verifier and downstream PR handoff/merge stages rather than being marked
complete by the worker.

Residual caveat: `loops doctor` in this worker sandbox reported a stale daemon
pid file and Codewith auth-profile preflight failures caused by `EROFS` on
`/home/hasna/.codewith`. The targeted durable drain loop itself was listed
active, its command preflight was ready, and `loops runs --limit 30` showed
`machine-drain-pr-docs-drain-v2` succeeded for slot
`2026-07-07T14:50:06.979Z`.
