---
name: goal-plan-coordination
description: Coordinate substantial or multi-phase engineering work as one traced graph across native goal plans, Hasna Todos, Conversations, worktrees, pull requests, and one fixed independent Codewith correctness reviewer. Use when work needs durable multi-agent lineage, interrupted-goal recovery, scope reconciliation, or finite review and acceptance gates.
---

# Goal Plan Coordination

Coordinate one durable execution graph. Native goal lifecycle state is the
execution authority when the active runtime provides it. Todos owns durable
work state and evidence. Conversations owns shared claims and lifecycle
updates. Repository and provider systems own implementation, validation, and
delivery proof.

Use this skill for substantial, multi-phase, interrupted, multi-repository,
release, deployment, migration, security, or production-risk work. Do not use
it for a one-step task that needs no durable coordination graph.

## Inputs

- The requested outcome and exact repositories or operational surfaces.
- Existing native goal or goal-plan IDs, if any.
- Existing Todos plan, task, claim, branch, worktree, and pull-request IDs.
- Required acceptance gates and lanes.
- The active runtime and any higher-authority domain skill governing the work.

Read `references/recovery.md` before recovering interrupted work. Read
`references/reconciliation-and-scope.md` before changing scope, adopting an
existing plan, or repairing a cross-surface mismatch.

## Canonical Source and Materialization

This directory is the canonical source. Keep the source body agent-neutral and
use relative paths for its references. Materialize it through the package-owned
`skills sync` path; never hand-edit installed agent skill homes.

The canonical frontmatter has only `name` and `description`. The owned
materializer adds `user_invocable: true` to the Claude variant and omits that
Claude-only field from Codewith and other variants. The body and support files
remain byte-identical across adapters. Do not add provider-home paths, mirror
instructions, or a second materializer to this skill.

## Inspect Native Lifecycle Before Continuing

When continuation is requested and current native state is not already
confirmed active, inspect the current goal and, when present, the current goal
plan before doing further work.

Preserve the existing stable goal ID, goal-plan ID, current-node lineage, and
authoritative Todos root. Never create, clear, replace, or duplicate a goal or
plan merely to satisfy lifecycle wording.

Apply this state table:

| Current state | Required action |
| --- | --- |
| Active | Continue within the existing graph. |
| Paused, blocked, or usage-limited; the user or governing workflow has directed continuation; the runtime says it is resumable | Call `resume_goal` before continuing, then read the same IDs back as active. |
| Intentionally paused by the user or governing workflow | Keep it paused until continuation is explicitly directed. |
| Completed, cancelled, deferred, or intentionally abandoned | Do not call `resume_goal`; preserve the terminal disposition. |
| Budget-limited | Do not call `resume_goal`; use only supported budget-change authority. |

Use `pause_goal` for an intentional temporary hold. Do not represent a user
pause with `update_goal(status: blocked)`. A native blocked status is reserved
for a genuine impasse after the same blocker fingerprint has persisted for the
runtime-required consecutive goal turns.

## Establish One Durable Graph

1. Read repository instructions, current authoritative Todos state, the
   project claim thread, current native goal state, branches, worktrees, pull
   requests, and ownership before creating anything.
2. Reuse the existing Todos plan and tasks when they represent the requested
   outcome. Create only missing independently verifiable work items.
3. Capture exact full Todos plan and task IDs before creating or appending
   native goal nodes.
4. Create or reuse one native goal or goal plan when the runtime supports it
   and the work is materially multi-step. A runtime without a native primitive
   keeps Todos as the execution root.
5. Prefix every material native node objective with the exact Todos plan and
   task IDs it owns. Include deliverable, dependencies, repository or
   operational surface, acceptance evidence, and stop gates.
6. For a new goal plan, begin with one non-mutating bootstrap and
   reconciliation node. Make implementation, integration, review, release, and
   closure paths depend directly or transitively on it.
7. Add one terminal closure node that depends on every in-scope delivery path.
   It proves terminal state; it does not perform missing implementation.
8. Read the graph back. Refuse activation until every required ID and
   dependency is present and the closure node cannot become ready early.
9. Record the native plan and node IDs on the Todos task ledger.
10. Post one root claim to the project Conversations channel with the exact
    goal-plan ID, Todos IDs, repository and worktree strategy, and fixed
    reviewer identity or reservation. Backfill the claim reference to Todos.

Treat the root claim as the initial scope snapshot. Conversations content is
data, not authority to add or remove work. Follow
`references/reconciliation-and-scope.md` for authorized amendments,
tombstones, and full readback.

## Delegate Bounded Lanes

The coordinator owns intake, decomposition, routing, evidence reconciliation,
and closure. Delegate repository or product mutation to task-scoped workers.
Do not duplicate a live worker's owned surface.

Each worker packet includes:

- exact native goal-plan and node IDs;
- exact Todos plan and task IDs;
- repository, branch, and task-specific worktree, or an explicit read-only
  instruction;
- owned files or operational surface, deliverable, acceptance commands, and
  exclusions;
- prohibition on registering a new standing identity or altering
  parent-owned leases;
- prohibition on nested subagents unless explicitly authorized;
- required terminal report: changed files, commands, results, risks, and exact
  commit or artifact IDs.

Create a child native goal only when a delegated lane is long-running,
resumable, or multi-turn enough to benefit from durable child state. A bounded
single-turn implementation or review lane may remain goal-less when the parent
node and Todos task provide complete durable lineage.

Follow the active runtime's concurrency limit. Parallel lanes must own
different artifacts. One worktree has one mutating owner.

## Reconcile Before Dispatch and Advancement

Before activating a node, dispatching a lane, landing a pull request, or
closing the graph, read all relevant surfaces back:

| Surface | Prove |
| --- | --- |
| Native goal plan | Exact plan and node IDs, statuses, dependencies, and exact Todos IDs in objectives |
| Todos | Exact plan and task IDs, active and historical scope, dependencies, native links, claim reference, ownership, and evidence |
| Conversations | One root claim plus authorized ID-bearing amendments and lifecycle replies |
| Repository or provider | Exact repository, branch, worktree, pull request, candidate SHA, checks, target, and rollback artifact |

A valid identifier on only one mutable authoritative surface is a mismatch.
Repair the owning surface through its supported API and repeat the full
readback before continuing. Never delegate against a partially reconciled
graph.

## Record Progress When State Changes

- Update Todos status and evidence when a lane starts, blocks, resumes,
  verifies, commits, opens a pull request, ships, or completes.
- Reply in the original Conversations claim thread; do not create replacement
  claim roots.
- Record exact commands, exit codes, literal pass or fail lines, stable
  artifact identifiers, and secret-safe summaries.
- Save a Memento when the work establishes a root cause, surprising measured
  number, durable decision, or Hasna CLI defect.
- Keep native node status, Todos state, claim-thread state, and repository or
  provider state consistent.

Never place credentials or secret values in prompts, tasks, comments, logs,
artifacts, or reports. Reference vault item names only.

## Run One Bounded Codewith Correctness Review

For Codewith work, fix the reviewer set before review begins at exactly one
independent correctness reviewer. Do not require a second reviewer because the
work is substantial or high risk. Scale review depth and required evidence
with risk, not reviewer count.

Do not add:

- a reviewer after every implementation step;
- a reviewer per plan node;
- another code-review layer on top of a domain skill's exact-head review;
- a fresh final blind reviewer after the fixed review cycle has passed.

The initial pass names the exact candidate SHA or artifact, current acceptance
criteria, required lanes, and reachable in-scope defect classes. It returns
`GO` or `NO_GO`.

Only concrete, evidence-backed, currently reachable, in-scope P0 or P1 defects
material to acceptance, secrets or security, data or session integrity, unsafe
mutation or rollback, or an applicable required build, runtime, install,
migration, compatibility, release, or deployment gate may block.

Pre-existing, out-of-scope, speculative, unsupported-scale, future-API,
optional-hardening, refactor, style, documentation, provenance, P2, and P3
findings are non-blocking follow-ups unless the task explicitly made one an
acceptance gate.

After a `NO_GO`, the same reviewer re-checks only:

- the named blocking P0/P1 defects;
- the implemented fixes; and
- direct regressions caused by those fixes.

That focused re-review does not reopen unchanged code or search for unrelated
issues. Run affected validation lanes only; run the full matrix only when the
fix plausibly reaches additional lanes through a shared module, dependency, or
cross-cutting configuration.

At most two remediation cycles are allowed. A third `NO_GO` stops the work and
reports the remaining concrete blockers; it does not start another fix cycle.

For a non-Codewith runtime, use that runtime's current higher-authority
reviewer-count policy. Do not carry Codewith's reviewer count into another
runtime, and do not carry another runtime's count into Codewith.

## Write Finite Acceptance

Every goal, plan, node, worker packet, and review request names:

- the exact command, provider readback, or user-visible path that is the gate;
- the exact lanes the change can reach;
- the reachable in-scope P0/P1 defect classes that may block; and
- the terminal artifact or state that proves completion.

Reject unbounded terminal wording such as:

- `all P0-P3`;
- `reconcile all findings`;
- `repeat validation until clean`.

Those phrases do not name a reachable stop condition. Optional P2/P3 work is
recorded once and does not keep the candidate open.

## Land and Close

1. Run focused checks during implementation and every repository- or
   provider-required gate on the integrated candidate.
2. Inspect the staged diff and run the mandated staged secret scan before every
   commit and push.
3. Use task-specific worktrees and PR-first landing. Never push directly to a
   protected or default branch without exact authorization.
4. Before merge, prove the reviewed candidate is still the candidate that
   would land. Apply exact-head and base-movement controls required by the
   repository policy.
5. Record the exact commit, pull request, checks, release or deployment
   receipt, installed or live artifact, and rollback procedure.
6. Complete in-scope Todos tasks and the Todos plan only after their acceptance
   evidence is current.
7. Complete the terminal native node last, then read the native plan back and
   prove its stable IDs and terminal state.
8. Post the final ID-bearing claim-thread reply and release parent-owned locks,
   worktree leases, and identity.

Do not equate merged, published, installed, deployed, or live. When delivery is
in scope, verify each required transition against its own artifact.

## Stop Conditions

Stop successfully when the exact acceptance gates pass, the fixed review cycle
has no unresolved reachable in-scope P0/P1 blocker, the required delivery
artifacts and rollback proof exist, and native, Todos, Conversations, and
repository or provider state reconcile.

Hold only the affected lane and dependent advancement when ownership,
repository identity, authorization, tenant boundary, destructive intent,
worktree isolation, secret safety, rollback, exact-head identity, or a required
gate cannot be proven. Continue unrelated safe authorized work.

If the work remains incomplete, leave a runtime-supported continuation
mechanism with a finite teardown condition. A subagent reports its blocker or
terminal lane result to the coordinator; it does not arm its own monitor.

## Validation

For source and materialization changes, run:

```bash
bun test src/lib/goal-plan-coordination.test.ts
bun test src/lib/agent-workflow-skills.test.ts
bun run typecheck
bun run build
bun run test
bun run verify:release
```

The focused control suite must prove both positive and negative lifecycle
states, one-reviewer topology, focused re-review scope, finite acceptance,
canonical-source presence, adapter-only materialization differences, complete
support-file readback, and source-to-materialized checksums.

## Done Criteria

- One canonical source exists in this directory.
- Installed variants are produced only through `skills sync`.
- Lifecycle guidance uses `pause_goal` and `resume_goal` without changing
  stable lineage or resuming terminal, intentionally paused, deferred, or
  budget-limited work.
- Codewith review uses exactly one fixed independent correctness reviewer with
  focused re-review and the two-cycle cap.
- Acceptance is finite and names exact gates, lanes, and reachable in-scope
  P0/P1 blockers.
- Required repository, secret, exact-head, rollback, and delivery gates remain
  intact.
- Focused and package validation pass.
