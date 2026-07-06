# Automation Runtime Design

OpenLoops can execute workflow work that external automation systems have
already materialized, but it must not become the automation product surface.
`@hasna/automations` and `@hasna/actions` own automation specs, trigger
materialization, queue state, approvals, DLQ/replay, idempotency, and audit
evidence. OpenLoops owns workflow invocation, admission, execution, run
manifests, and provider routing once work is explicitly handed off.

## Current Template Contract Surface

OpenLoops built-in workflow templates expose a versioned `contract` through
`loops templates list/show` JSON. The contract carries a JSON-schema-shaped
`inputSchema`, `outputSchema`, `taskBinding`, `requiredEvidence`, and
`policyRequirements`. Custom templates may declare the same object; otherwise
OpenLoops derives a conservative manual-workflow contract from their variables.

The current event-triggered path is `loops routes create todos-task` for
`@hasna/todos` `task.created` events and `loops routes create generic` for
generic `@hasna/events` envelopes. Dry-run and `--preflight` output include the
full selected `templateContract`, while the created `WorkflowInvocation` stores
a compact contract reference plus output schema, required evidence, and policy
requirements in `outputPolicy`. This gives event-triggered runs the same typed
admission/evidence contract as cron or interval scheduled workflow loops without
requiring callers to scrape prompt text.

## Planned Workflow Upsert SDK

External compilers should not write OpenLoops SQLite rows directly. The stable
contract should be an idempotent CLI/SDK upsert that accepts a fully rendered
one-shot workflow loop request and returns durable refs.

Proposed SDK shape:

```ts
type WorkflowUpsertRequest = {
  idempotencyKey: string;
  source: { kind: "action" | "automation" | "event"; id: string; dedupeKey?: string };
  subject: { kind: "repo" | "task" | "pr" | "run"; id?: string; path?: string; url?: string };
  workflow: { name: string; description?: string; steps: WorkflowStepInput[] };
  loop: { name: string; schedule: { type: "once"; at: string }; machine?: LoopMachineRef };
  route?: { projectPath?: string; projectGroup?: string; concurrencyGroup?: string };
  execution?: AutomationExecutionPolicy;
  mode?: "dry-run" | "preflight" | "commit";
  dispatch?: "schedule" | "run-now" | "none";
};

type AutomationExecutionPolicy = {
  mode: "standard" | "strict";
  envAllowlist?: string[];
  secretRefs?: Array<{ env: string; ref: string; required?: boolean }>;
  allowTools?: string[];
  allowCommands?: string[];
  requireEnforcement?: boolean;
  redactionProfile?: "default" | "strict";
};

type WorkflowUpsertResult = {
  ok: boolean;
  dryRun: boolean;
  idempotencyKey: string;
  specHash: string;
  refs: {
    workflowId?: string;
    loopId?: string;
    invocationId?: string;
    workItemId?: string;
    runId?: string;
    manifestPath?: string;
  };
  action: "created" | "updated" | "reused" | "rejected";
  preflight?: { ok: boolean; checks: unknown[]; error?: string };
};
```

Required semantics:

- `mode="dry-run"` validates, canonicalizes, hashes, and returns the same JSON
  shape without mutating OpenLoops state.
- `mode="preflight"` additionally checks provider binaries, machine routing,
  accounts/auth profiles, prompt files, and workflow target compatibility before
  commit.
- `mode="commit"` is idempotent on `idempotencyKey` plus `specHash`: identical
  requests return existing refs; changed specs create a new workflow version or
  one-shot loop while preserving previous run history.
- `dispatch="schedule"` stores a one-shot loop for the daemon; `run-now` claims
  an immediate manual slot; `none` only materializes refs for another owner to
  trigger later.
- All persisted output is redacted before storage, and returned refs are enough
  for the caller to inspect, cancel, replay, or resolve the run without querying
  SQLite directly.

## CLI Surface

The planned CLI should mirror the SDK:

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

`--mode dry-run` must not create a database file in an empty `LOOPS_DATA_DIR`.
`--mode preflight` must report the exact provider/account/worktree check that
would fail. `--mode commit` must return the durable refs required for later
inspection and replay.

## Planned Strict Automation Execution

Automation-generated targets need a stricter execution mode than ordinary local
agent loops. Strict mode should make execution reproducible, auditable, and
secret-safe without depending on ambient shell state.

### Policy

`execution.mode="strict"` means:

- Do not inherit full `process.env`. Start from a minimal runtime environment:
  `PATH`, `HOME`, `TMPDIR`, locale keys, OpenLoops metadata keys, and tool
  config dirs explicitly produced by account/secret resolution.
- Pass only named `envAllowlist` values and `secretRefs`; never embed secret
  values in workflow specs, prompts, metadata, manifests, or task comments.
- Resolve `secretRefs` at run time through the owning secret/action system and
  inject them only into the child process that needs them.
- Default provider posture is safe: `configIsolation="safe"`, no
  `permissionMode="bypass"`, worktree mode `required` for repo mutation, and
  provider-native sandboxing where available.
- Persist stdout, stderr, error, workflow events, and manifests only after
  redaction. Strict redaction must treat `env`, `secret`, `token`, `key`,
  `authorization`, `stdout`, `stderr`, `error`, `prompt`, and provider raw
  response payloads as sensitive by default.

### Allowlist Enforcement

Current `allowlist` metadata is advisory. Strict automation requires real
enforcement:

- If `requireEnforcement=true`, preflight must reject providers that cannot
  enforce the requested tool or command allowlist.
- Codewith/Codex should map allowed tools and commands to provider-native flags
  or policy files when those surfaces are available.
- Command targets should run through a small policy wrapper that rejects
  unlisted executables before `exec`.
- Providers without enforceable allowlists may still run in `standard` mode,
  but strict automation should fail before storing or dispatching them.

### CLI Surface

Planned flags:

```bash
loops workflows upsert-one-shot ./workflow.json \
  --execution-mode strict \
  --env-allow PATH,HOME,TMPDIR \
  --secret-ref OPENROUTER_API_KEY=hasna/openrouter/live/api-key \
  --allow-command bun,test,git \
  --allow-tool functions.exec_command \
  --require-allowlist-enforcement \
  --redaction-profile strict \
  --mode preflight \
  --json
```

Strict-mode dry runs must show the effective policy and redacted env names, not
secret values. Strict-mode preflight must fail with a policy classification when
any required env, secret, account profile, provider sandbox, or allowlist
enforcement surface is missing.

## Planned DLQ And Replay

OpenLoops already models terminal route work items and has a manual
`routes requeue` command. The automation runtime contract needs a stricter DLQ
layer for exhausted side-effecting work, because external action systems need to
distinguish "failed attempt", "dead until operator action", and "resolved".

### States

Route work items should keep these meanings:

- `failed`: a terminal attempt failed, but policy may still allow an explicit
  replay after the cause is fixed.
- `dead_letter`: automatic attempts are exhausted or the failure is classified
  as unsafe to retry without operator action.
- `cancelled`: an operator or owner intentionally stopped the work.
- `succeeded`: the work completed and remains deduped history.
- `resolved`: planned external DLQ state for `@hasna/actions`; OpenLoops can
  mirror it as `dead_letter` plus a resolution event until a first-class status
  is added.

### Commands

Planned command surface:

```bash
loops dlq list --route-key actions --status dead_letter --json
loops dlq show <work-item-id> --json
loops dlq replay <work-item-id> --reason "credential rotated" --idempotency-key <new-key> --json
loops dlq resolve <work-item-id> --reason "superseded upstream" --resolution superseded --json
```

`list` and `show` must join the work item, invocation, workflow, loop, latest
workflow run, step runs, run manifest path, classification, attempt count, and
last redacted error. `replay` must be idempotent: the same replay request with
the same new idempotency key returns the same refs; a different key records a
new replay attempt linked to the original work item. `resolve` must never run
provider code; it only records why the DLQ entry no longer needs execution.

### Replay Semantics

- Replay requires a human-readable `--reason`; automation callers also pass the
  original action id and a new replay idempotency key.
- Replay clears stale loop/workflow/run refs only for terminal work items and
  never for `queued`, `admitted`, or `running` items.
- Replay preserves source, subject, manifest, and previous failure history so
  audits can explain why another attempt exists.
- Replay of side-effecting work should default to `mode=preflight`; promotion
  to `mode=commit` is a separate operator/API decision unless the owning
  `@hasna/actions` policy marks the action safely replayable.
- If `@hasna/actions` owns the queue, OpenLoops calls the action replay API and
  stores the returned action/run refs instead of fabricating queue state.

### Dead-Letter Classification

The first implementation should classify terminal failures into:

- `preflight`: missing provider binary, account profile, worktree, prompt file,
  or machine route.
- `auth`: invalid credentials or expired provider account.
- `policy`: manual gate, approval gate, no-auto tag, or strict execution mode
  denial.
- `transient`: network, rate limit, provider overload, or lease loss.
- `bug`: deterministic command/test failure, schema mismatch, or code exception.
- `unknown`: fallback when no classifier is confident.

Only `transient` and explicitly marked `bug` fixes should be eligible for
automatic replay policy. `auth`, `policy`, and `preflight` need operator or
owning-system resolution evidence before replay.
