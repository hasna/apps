# Recover Interrupted Coordination

Use this procedure at startup after an interrupted session, and whenever the
user asks to continue work whose native goal state is not already confirmed
active.

## Read Before Writing

Read:

- the current native goal and, when present, goal plan;
- the existing Todos plan and tasks;
- the original Conversations claim thread;
- repository, branch, worktree, pull-request, and exact-head state;
- current task, identity, artifact-lock, and worktree owners; and
- delivery, rollback, schedule, loop, or monitor state that belongs to the
  requested outcome.

Do not create, claim, delegate, or mutate anything until this readback
distinguishes an existing graph from missing state.

## Resume Native State Correctly

When continuation is directed:

1. If the native goal is active, continue in the same graph.
2. If it is paused, blocked, or usage-limited and the runtime says it is
   resumable, call `resume_goal` before doing further work.
3. Read the goal and plan back. The same goal ID, goal-plan ID, current-node
   lineage, and Todos root must now be active.
4. If it was intentionally paused, keep it paused until continuation is
   explicitly directed.
5. Never call `resume_goal` for completed, cancelled, deferred, intentionally
   abandoned, or budget-limited work.
6. Never create a replacement goal merely because resumption is unavailable.
   Preserve the exact terminal state or record the precise native gate.

Use `pause_goal` for an intentional temporary hold. Do not translate a user
pause into `update_goal(status: blocked)`.

## Recover the Existing Graph

Resume the same coordination graph, original claim thread, native plan, tasks,
branches, and worktrees when they still represent the requested outcome.
Reconstruct the active current scope and complete historical task set from
authoritative Todos/native mutations plus the root claim and authorized
ID-bearing amendment records.

Never overwrite or silently replace active ownership. Reclaim a task, identity,
artifact lock, worktree, schedule, or lease only through the owning CLI's
documented expiry, release, handoff, or takeover path and only after its
preconditions are proven.

If another live owner conflicts with the intended mutation surface, stop that
lane and record the collision. Do not create a duplicate plan, task set, claim
root, branch, or worktree to bypass the owner.

## Missing Original Claim

If the native goal plan and Todos ledger exist but no root claim exists:

1. Search the project channel for the exact native plan ID and Todos plan ID.
2. Inspect task references for an existing claim.
3. Prove absence with bounded readback.
4. Create the missing original root through the normal claim procedure.
5. Capture and backfill its thread reference.
6. Reconcile all surfaces before dispatch.

Describe it as the original root created during recovery, never as a
replacement root.

## Record Continuity

Add a continuity comment to the umbrella task and each affected task. Reply in
the existing claim thread with:

- exact native goal-plan and node IDs;
- exact Todos plan and task IDs;
- active and historical scope;
- recovered ownership and artifact state;
- exact next action and finite acceptance gate; and
- continuity mechanism and teardown condition when work remains.

Update the Todos plan itself only when the installed CLI exposes a supported
mutable plan surface.
