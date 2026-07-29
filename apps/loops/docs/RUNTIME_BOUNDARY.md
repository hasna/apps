# Loops Runtime Boundary

Loops is the **runtime, scheduler, and workflow engine** for automations.
It executes work that external systems have already materialized or explicitly
handed off. It is **not** the automation domain model: specs, triggers, queue
ownership, approvals, DLQ/replay, idempotency, and audit evidence live in
`@hasna/automations`, `@hasna/actions`, and related product packages.

Use this document when you need a single operator-facing boundary reference.
For the planned upsert/DLQ/strict-mode contract, see
[`AUTOMATION_RUNTIME_DESIGN.md`](./AUTOMATION_RUNTIME_DESIGN.md). For
storage vocabulary (the sqlite|http client seam and sqlite|postgres server
backend), see [`STORAGE.md`](./STORAGE.md).

## Ownership Split

| Concern | Owner | Loops role |
| --- | --- | --- |
| Automation specs and trigger materialization | `@hasna/automations` | None — do not store specs in Loops |
| Product automation action queues, leases, DLQ, replay, idempotency, approvals, audit | `@hasna/automations` | Execute claimed actions; complete/fail by action id + runner id |
| Action compilation and action-target rendering | `@hasna/actions` | Accept planned upsert handoff; do not write SQLite rows directly |
| Scheduler, daemon, loop/workflow storage | Loops | Authoritative in `local` mode |
| Workflow invocation, admission, execution, run manifests | Loops | After explicit handoff or todos-task route admission |
| Provider routing, worktrees, run artifacts | Loops | Bounded by route and template policy |
| Todos-task route drains (`auto:route`, `route_enabled`, `automation.allowed`) | Loops-native | Opt-in task/event routing — **not** OpenAutomations queue replacement |

The SDK exposes the canonical boundary strings via `openAutomationsRuntimeBinding()`:

```ts
import { openAutomationsRuntimeBinding } from "@hasna/loops";

const binding = openAutomationsRuntimeBinding();
// binding.handoff === "claim-queue"
// binding.queueOwner === "open-automations"
// binding.runtimeOwner === "open-loops"
console.log(binding.guarantees);
console.log(binding.nonGoals);
```

**Guarantees (summary):**

- OpenAutomations owns automation specs, run materialization, queue state, DLQ,
  replay, idempotency, and approvals.
- Loops may execute claimed actions through explicit command or SDK handoff
  only.
- Loops may consume exported event envelopes only through explicit
  `loops routes create` commands.
- Workers must complete or fail actions by action id and runner id so
  OpenAutomations can enforce queue leases.

**Non-goals (summary):**

- Loops must not become the OpenAutomations product surface.
- Loops must not store automation specs or replace the OpenAutomations queue.
- Loops must not infer automation trigger semantics from event transport
  alone.

## External Compiler Handoff Paths

External compilers (`@hasna/automations`, `@hasna/actions`, event routers)
materialize automation intent in their own stores. Loops receives **rendered
work** through one of the paths below. Do not bypass these boundaries by writing
Loops SQLite rows from another package.

### 1. OpenAutomations claim-queue (implemented)

OpenAutomations owns the action queue. A Loops worker claims work, runs the
rendered target, and reports completion back to OpenAutomations.

```bash
# Worker claims from the OpenAutomations queue
automations queue claim --runner open-loops:<worker-id>

# After Loops executes the handed-off command/workflow:
automations queue complete <action-id> --runner open-loops:<worker-id>
# or on failure:
automations queue fail <action-id> --runner open-loops:<worker-id> \
  --code <code> --message <message>
```

Keep `HASNA_AUTOMATIONS_DIR` pointing at the owning OpenAutomations data root.
Preserve the runner id in every complete/fail call so OpenAutomations can enforce
action leases.

SDK reference:

```ts
const binding = openAutomationsRuntimeBinding();
console.log(binding.claimCommand);   // "automations queue claim"
console.log(binding.completeCommand); // "automations queue complete"
console.log(binding.failCommand);    // "automations queue fail"
```

### 2. `@hasna/actions` compiler → planned upsert-one-shot (design)

`@hasna/actions` compiles action targets into a fully rendered one-shot workflow
loop request. The stable handoff is an **idempotent upsert** — not direct
SQLite access.

**Status:** `loops workflows upsert-one-shot` and the matching SDK method are
**planned** (see [`AUTOMATION_RUNTIME_DESIGN.md`](./AUTOMATION_RUNTIME_DESIGN.md)).
The shapes below are the contract target; they are not shipped in this release.

Example request the compiler would send (abbreviated):

```ts
type WorkflowUpsertRequest = {
  idempotencyKey: "actions:<action-id>:<version>",
  source: { kind: "action", id: "<action-id>" },
  subject: { kind: "repo", path: "/path/to/repo" },
  workflow: { name: "action-<action-id>", steps: [/* rendered steps */] },
  loop: { name: "action-<action-id>", schedule: { type: "once", at: "2026-07-01T12:00:00Z" } },
  mode: "preflight",       // dry-run | preflight | commit
  dispatch: "schedule",    // schedule | run-now | none
};
```

Planned CLI mirror:

```bash
loops workflows upsert-one-shot ./workflow.json \
  --idempotency-key actions:<action-id>:<version> \
  --source-kind action \
  --source-id <action-id> \
  --subject-kind repo \
  --subject-path /path/to/repo \
  --loop-name action-<action-id> \
  --at 2026-07-01T12:00:00Z \
  --mode preflight \
  --dispatch schedule \
  --json
```

Loops returns durable refs (`workflowId`, `loopId`, `runId`, `manifestPath`)
so `@hasna/actions` can inspect, cancel, or replay without querying SQLite.
Full semantics (idempotency on `idempotencyKey` + `specHash`, redaction,
strict-mode policy) are specified in the design doc — not duplicated here.

### 3. Event envelope handoff (implemented, explicit only)

For workflows that should run from a normalized event envelope — **without**
OpenAutomations materializing automation specs inside Loops — pipe an
exported envelope into the generic route:

```bash
automations --json webhooks event <route> --body-json '<json>' \
  | loops --json routes create generic
```

This is **not** automation materialization in Loops. OpenAutomations still
owns deterministic automation specs, webhook normalization, queue state,
approvals, DLQ, and replay. Loops owns agent workflow invocation after the
operator routes the envelope to `loops routes create generic`.

```ts
const { eventHandoff } = openAutomationsRuntimeBinding();
console.log(eventHandoff.handlerCommand); // "loops routes create generic"
console.log(eventHandoff.boundary);
```

## Loops-Native Path: Todos-Task Routes

Todos-task routing is a **Loops-native** admission path. It is separate from
the OpenAutomations product queue:

```bash
cat task-created-event.json | loops routes create todos-task \
  --template task-lifecycle \
  --worktree-mode required
```

Tasks must opt in (`auto:route`, `route_enabled=true`, or
`automation.allowed=true`). Loops admits deduped one-shot workflow loops,
drains them on a schedule, and writes run manifests under
`.hasna/loops/runs/<project-slug>/<subject-key>/<run-id>/`.

This path does **not** make OpenAutomations the queue owner for todos task/PR/review
agent workflows. It also does **not** replace OpenAutomations action queues for
product automations. Choose the handoff path that matches who owns the queue and
audit trail for your automation.

See [`USAGE.md`](./USAGE.md) § Templates And Task Events for templates,
provider rules, and drain examples.

## Anti-Patterns

Do **not**:

- Store automation specs in Loops loop/workflow rows.
- Infer automation triggers from event transport alone.
- Replace the OpenAutomations queue with loop/workflow rows.
- Write Loops SQLite directly from `@hasna/actions` or `@hasna/automations`.
- Dispatch or paste task prompts into tmux panes from route drains (use headless
  workflow templates instead).

## Related Docs

- [`AUTOMATION_RUNTIME_DESIGN.md`](./AUTOMATION_RUNTIME_DESIGN.md) — planned
  upsert SDK, DLQ/replay, strict automation execution mode.
- [`USAGE.md`](./USAGE.md) — templates, todos-task routes, provider pools.
- [`STORAGE.md`](./STORAGE.md) — the sqlite|http client seam and sqlite|postgres server backend;
  deployment concerns are runtime placement, not automation product surface.
- README § OpenAutomations Runtime Binding — short summary and quick references.
