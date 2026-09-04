# Loops

Loops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

Naming: the product is **Loops**, published on npm as
[`@hasna/loops`](https://www.npmjs.com/package/@hasna/loops) and developed in the
[`hasna/loops`](https://github.com/hasna/loops) repository. The installed
binaries are `loops`, `loops-daemon`, `loops-serve`, `loops-runner`, and
`loops-mcp`. The embeddable API remains available as `@hasna/loops/api`.

Loops is the **runtime, scheduler, and workflow engine** for automations —
not the automation domain model. Specs, triggers, queue ownership, approvals,
DLQ/replay, and audit live in `@hasna/automations` and `@hasna/actions`; see
[Runtime Boundary](docs/RUNTIME_BOUNDARY.md) for ownership split and external
compiler handoff examples.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `agent` (Cursor Agent CLI)
- `codewith exec`
- `aicopilot run`
- `opencode run`
- `codex exec`

## Storage And Connections

Loops has no deployment modes. Storage is SQLite (the zero-configuration local
file at the effective Loops data home — `~/.hasna/loops/loops.db` by default,
resolved through `@hasna/paths` to the XDG data home once the store is migrated
there or `HASNA_DATA_HOME` is set, or `$LOOPS_DATA_DIR/loops.db` when the
exact-app override is set) or PostgreSQL
(explicitly configured on `loops-serve` via `HASNA_LOOPS_DATABASE_URL`).
Clients connect either to the local file (`connection=file`) or to a
control-plane HTTP API (`connection=api`, selected by `HASNA_LOOPS_API_URL`
plus `HASNA_LOOPS_API_KEY`). Neither is a default: an invocation with no API
env and no explicit selection FAILS CLOSED with a non-zero exit and an error
naming the required variables — the client never silently serves the local
SQLite file when the API env is missing. The file connection is an EXPLICIT
opt-in (`HASNA_LOOPS_CONNECTION=file`); the API connection requires both
variables (`HASNA_LOOPS_CONNECTION=api` additionally enforces that). Setting
`HASNA_LOOPS_CONNECTION=file` alongside the API variables is a contradiction
and is rejected. The former `HASNA_LOOPS_STORAGE_MODE` variable is deleted and
rejected if present.

The public `@hasna/loops` package owns the local runtime, the Postgres storage
adapter, the control-plane API contract, tenant authentication and
authorization, runner contract, SDK, MCP server, and CLI. Account provisioning
and infrastructure deployment remain operator responsibilities. `loops status`
reports the storage backend and client connection (`storage=sqlite|postgresql`,
`connection=file|api`). Scheduler state is explicit in status JSON:
`schedulerState.localStore` is SQLite plus local run artifact files,
authoritative on the file connection; `schedulerState.remoteStore` names the
configured control-plane contract (`api_control_plane_contract`,
`postgres_contract`, or `hosted_control_plane_contract`). The standalone `loops`
CLI reports `applySupported=false` for control-plane apply because it does not
perform id-preserving remote migration, S3/object storage mutation, AWS
resource mutation, or hosted credential mutation. `loops-serve` mutates
Postgres for normal control-plane CRUD and runner protocol routes when it is
explicitly configured. Route admission remains bounded by `max_dispatch`,
`max_active`, `max_active_per_project`, `max_active_per_project_group`,
`max_active_scope`, and `max_per_profile`.

Useful status and setup commands:

```bash
loops status
loops --json status
loops migrate --dry-run
loops push --dry-run
loops pull --dry-run
loops export --file ./loops-export.json --dry-run
loops export --file ./loops-export.json
loops import ./loops-export.json
loops import ./loops-export.json --apply
loops-serve version
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run
loops-serve db-credentials reconcile
HASNA_LOOPS_DATABASE_URL=... HASNA_LOOPS_AUTH_DATABASE_URL=... loops-serve serve
loops-runner status
```

`loops push` is safe by default: imported workflows are archived and
imported loops are paused with `nextRunAt`/`retryScheduledFor` cleared. Even
without `--replace`, the control-plane import boundary may rewrite existing
same-id workflows/loops into that disabled representation; use explicit
preserve flags only for an intentional activation.

See [Storage Backends And Client Connections](docs/STORAGE-BACKENDS.md) for the
full package boundary and machine-placement contract.

### Provider database credentials

`loops-serve db-credentials reconcile` is the fixed in-cluster reconciler for
provider-managed RDS app credentials. It reads the RDS-managed master secret
with the AWS Secrets Manager SDK, builds `sslmode=verify-full` DSNs only in
memory, and writes each app DSN to that app's Secrets Manager secret through
`AWSPENDING` before promoting `AWSCURRENT`. It never accepts database URLs,
passwords, access keys, profiles, or secret material as command flags.

Required environment is intentionally strict: `AWS_REGION`,
`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `HASNA_LOOPS_RDS_MASTER_SECRET_ARN`,
`HASNA_LOOPS_MIGRATOR_DATABASE_URL_SECRET_ARN`,
`HASNA_LOOPS_RUNTIME_DATABASE_URL_SECRET_ARN`,
`HASNA_LOOPS_AUTH_DATABASE_URL_SECRET_ARN`, `HASNA_LOOPS_RDS_INSTANCE_ID`,
`HASNA_LOOPS_RDS_ENDPOINT`, `HASNA_LOOPS_RDS_PORT`,
`HASNA_LOOPS_RDS_DATABASE`, and `HASNA_LOOPS_RDS_MASTER_USERNAME`. Static AWS
credential environment variables, profile/web-identity inputs, full credential
URIs, non-RDS-style endpoints, duplicate secret ARNs, cross-region secret ARNs,
and malformed identifiers fail closed before any secret or database operation.

The command normalizes the fixed NOLOGIN database roles
`open_loops_owner`, `open_loops_migrator`, `open_loops_runtime`, and
`open_loops_authenticator`; manages exactly three LOGIN users
`open_loops_migrator_login`, `open_loops_runtime_login`, and
`open_loops_authenticator_login`; grants only the migrator login exact
owner/migrator membership plus `CREATEROLE`; and keeps runtime/authenticator
without memberships until migration `0010_tenant_enforce` has landed. After
`0010`, runtime and authenticator are attached only to their matching roles.
If PostgreSQL 16 implicit creator memberships cannot be normalized, the
reconciler fails before publishing app credentials.

## Install

**Loops requires the [Bun](https://bun.sh) runtime (`bun >= 1.0`).** The
`loops`, `loops-daemon`, `loops-serve`, `loops-runner`, and `loops-mcp`
binaries run with a `#!/usr/bin/env bun` shebang, so Bun must be on
`PATH` even when the package is installed with npm. Node.js is not a supported
runtime.

From npm (with Bun installed):

```bash
npm install -g @hasna/loops
loops --version
```

Update:

```bash
npm update -g @hasna/loops
loops daemon stop
loops daemon start
loops daemon status
```

Restart the daemon on every machine that runs scheduled loops; already-running daemon processes keep using the old package until restarted.

From source:

```bash
bun install
bun run build
bun link
```

The CLI stores state in `~/.hasna/loops` by default (resolved through `@hasna/paths`; the XDG data home is adopted once the store is migrated there or `HASNA_DATA_HOME` is set). Set `LOOPS_DATA_DIR` to isolate state for tests or another profile.

## MCP Server

Loops ships a stdio MCP server for safe loop and workflow inspection from
MCP-capable agents:

```bash
loops-mcp list-tools
loops-mcp
```

The package also exports the server factory for embedded hosts:

```ts
import { createLoopsMcpServer } from "@hasna/loops/mcp";
```

Available read tools include `loops_list`, `loops_show`, `loops_runs`,
`loops_doctor`, `loops_workflows_list`, `loops_workflow_read`, and
`loops_workflow_validate`.
`loops_list` and `loops_runs` accept label arrays with AND semantics.
Resources are available at `loops://runtime` and `loops://tools`.
Those tools use the same `Store`, public redaction helpers, and workflow parser
as the CLI and SDK, so read output and validation behavior stay aligned across
surfaces.

Mutation tools are disabled by default. Start the server with
`LOOPS_MCP_ALLOW_MUTATIONS=true` only for a trusted local MCP host that should be
allowed to change loop state. The guarded mutation tools use canonical names:
`loops_pause`, `loops_resume`, `loops_stop`, `loops_run_now`, `loops_archive`,
`loops_unarchive`, `loops_labels_update`, `loops_create_command`, and
`loops_create_workflow`.
Deprecated `loop_*` aliases are still registered where compatibility needs them,
but callers should use the `loops_*` names. Mutation tools do not require or
accept confirmation-string parameters; the server-side environment opt-in is the
gate. MCP `loops_run_now` schedules the loop for immediate daemon pickup; inline
execution remains CLI-only.
When `showOutput` is enabled, `loops_runs` caps each stdout/stderr field at
32,000 characters, caps output-bearing pages at 25 runs, and caps the aggregate
MCP JSON response at 128,000 characters.

Keep host-affecting or long-running operations on the CLI: daemon
start/stop/install/logs, inline `run-now`, `tick`, loop deletion, workflow
create/migrate/cancel/recover, agent loop creation, template materialization,
and event-route drains.

## Create Loops

Run a deterministic command every minute:

```bash
loops create command repo-status --every 1m --cmd "git status --short" --cwd /path/to/repo
```

Run a Claude loop every morning:

```bash
loops create agent morning-check \
  --provider claude \
  --cron "0 8 * * *" \
  --cwd /path/to/repo \
  --prompt "Check whether this repo is healthy and summarize required action."
```

Run a Claude loop with an isolated OpenAccounts profile:

```bash
loops create agent morning-check \
  --provider claude \
  --account work \
  --account-tool claude \
  --cron "0 8 * * *" \
  --cwd /path/to/repo \
  --prompt "Check whether this repo is healthy and summarize required action."
```

Run a Codewith loop every 15 minutes:

```bash
loops create agent supply-chain-watch \
  --provider codewith \
  --every 15m \
  --cwd /path/to/repo \
  --sandbox workspace-write \
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

Run a Codewith loop with a Codewith-native auth profile:

```bash
loops create agent supply-chain-watch \
  --provider codewith \
  --auth-profile account001 \
  --every 15m \
  --cwd /path/to/repo \
  --sandbox workspace-write \
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

Codewith `--auth-profile` is provider-native, not an OpenAccounts selector.
Local and remote preflight first request `codewith profile list --json` and
match the requested name exactly against the root `data` or `profiles`
inventory. That inventory is authoritative: `usable: false` rejects a profile,
legacy entries without `usable` remain usable, and `currentProfile` does not add
inventory membership. Loops falls back to the human-readable table,
including active `*` rows, only when JSON mode is unsupported or its inventory
is structurally unavailable. Embedded NUL bytes, missing profiles, and
non-fallback profile-list failures fail closed.

## Labels

Command, agent, and workflow loops accept repeatable labels:

```bash
loops create command repo-status --every 1m --cmd "git status --short" \
  --label BrowserPlan --label maintenance
loops list --label browserplan --label maintenance
loops runs --label browserplan
```

Labels are normalized to lowercase, deduplicated, limited to 32 per loop, and
must match `[a-z0-9][a-z0-9._-]{0,63}` after normalization. Repeated filters use
AND semantics. Run filtering uses the loop's current labels rather than a
historical snapshot on each run.

```bash
loops labels add repo-status urgent
loops labels remove repo-status maintenance
loops labels set repo-status browserplan nightly
loops labels clear repo-status
```

Run an OpenCode loop with an explicit provider/model. OpenCode reads
`~/.config/opencode/config.json` when no model is supplied, so Loops rejects
OpenCode agent targets without `--model` instead of inheriting a stale or
machine-specific default.

```bash
loops create agent opencode-smoke \
  --provider opencode \
  --model openrouter/google/gemini-2.5-flash \
  --at "$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)" \
  --cwd /path/to/repo \
  --prompt "Reply with exactly OK."
```

Direct agent loops can persist an auditable session contract:

```bash
loops create agent repo-check \
  --provider codewith \
  --every 15m \
  --cwd /path/to/repo \
  --sandbox workspace-write \
  --prompt "Check the repo and report concrete failures." \
  --allow-tool functions.exec_command \
  --allow-command git,bun \
  --safety-reason "isolated repository status inspection"
```

Tool and command lists are advisory metadata, not provider-enforced policy.
Loops stores the reason with the direct loop target, adds an explicit
advisory contract to provider stdin, and exports `LOOPS_AGENT_SESSION_CONTRACT`.
A direct agent loop has no workflow run, so it does not create a workflow event.
Agent steps inside workflows that carry an audit contract additionally receive
one server-derived `agent_session_contract` event per step and workflow run.

Codewith/Codex `danger-full-access`, Cursor `sandbox=disabled`, and provider
bypass modes (Claude, Cursor, AI Copilot, and OpenCode) require a non-empty
safety reason and either `--manual-break-glass` or `--automated`. A scheduled
durable lane (for example a deploy chain) is declared with `--automated` plus a
safety reason; `--manual-break-glass` remains the path for human-initiated
emergency access. A safety reason is always required.

For `codewith` and `aicopilot` account isolation, register matching OpenAccounts tools first if they are not built in on the machine:

```bash
accounts tools add codewith --label "Codewith" --env-var CODEWITH_HOME --bin codewith
accounts tools add aicopilot --label "AI Copilot" --env-var AICOPILOT_CONFIG_DIR --bin aicopilot
```

## Prompt Files

Use prompt files for production agent prompts instead of long inline strings.

```bash
mkdir -p ~/.hasna/loops/prompts
$EDITOR ~/.hasna/loops/prompts/repo-morning-check.md

loops create agent morning-check \
  --provider codewith \
  --auth-profile account001 \
  --cron "0 8 * * *" \
  --cwd /path/to/repo \
  --prompt-file ~/.hasna/loops/prompts/repo-morning-check.md
```

Workflow JSON also supports `promptFile` on agent targets. Relative paths
resolve from the workflow JSON file's directory:

```json
{
  "name": "repo-morning",
  "steps": [
    {
      "id": "review",
      "target": {
        "type": "agent",
        "provider": "codewith",
        "cwd": "/path/to/repo",
        "promptFile": "prompts/repo-morning-review.md"
      }
    }
  ]
}
```

Loops records `promptSource` metadata and redacts prompt bodies in public
CLI output by default, including `templates render`. Use
`~/.hasna/loops/prompts/<stable-name>.md` as the default prompt store for
production loops.

Reusable custom templates cannot contain `promptFile`. Keep prompt files in
direct workflow JSON or agent loop creation; use template variables only for
non-secret routing/configuration data.

## Goals

Add `--goal` to wrap a command, agent, or workflow loop in an AI-SDK orchestration layer. Loops asks the configured model to create a flat DAG plan, then executes ready plan nodes by re-running the underlying target once per node. Each node run is parameterized with that node's objective: agent prompts get the goal and node objective appended, and every wrapped process receives `LOOPS_GOAL_NODE_KEY` and `LOOPS_GOAL_NODE_OBJECTIVE` in its environment. An adversarial achievement audit runs before the goal is marked complete.

The goal `autoExecute` mode is honored: `off` plans and persists the DAG without executing any nodes (the run reports the persisted plan), while `readyOnly` (the default) and `aiDirected` run the dependency-driven execution loop over ready nodes.

```bash
export OPENROUTER_API_KEY=...

loops create agent repo-fixer \
  --provider codex \
  --at "$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ)" \
  --cwd /path/to/repo \
  --prompt "Work only on the requested repository task." \
  --goal "Fix the failing lint check and prove it with a passing lint run." \
  --goal-budget 2000 \
  --goal-model openai/gpt-4o-mini \
  --goal-max-turns 5
```

Goal planning and validation use the Vercel AI SDK with `@openrouter/ai-sdk-provider`. Set `OPENROUTER_API_KEY`; optionally set `LOOPS_GOAL_BASE_URL` to point at a local gateway compatible with OpenRouter. Goal context is passed to wrapped commands and agents as `LOOPS_GOAL_ID`, `LOOPS_GOAL_OBJECTIVE`, `LOOPS_GOAL_NODE_KEY`, and `LOOPS_GOAL_NODE_OBJECTIVE`.

If a resumed goal plan has no runnable nodes, failed run output includes a
structured `diagnostics` object with the concrete blocker and `owner`
(`goal`, `goal-plan`, or `goal-plan-node`) so scheduled workflow loops do not
end as opaque blocked plans.

Inspect configured and runtime goal state:

```bash
loops goal show <loop-or-goal-id>
loops goal show <goal-run-id-or-loop-run-id>
```

Workflow JSON can also embed goals at the workflow or step level:

```json
{
  "name": "goal-workflow",
  "goal": { "objective": "Complete the workflow and verify the evidence.", "maxTurns": 3 },
  "steps": [
    {
      "id": "fix",
      "goal": { "objective": "Finish this step and prove it with output evidence." },
      "target": { "type": "command", "command": "bun test", "shell": true }
    }
  ]
}
```

For **workflow loops** (`loops create workflow ...`), prefer a single loop-level
`--goal` wrapper around the scheduled workflow. Do not also define a top-level
`"goal"` on the workflow JSON spec: nested loop-level and workflow-level goal
wrappers deadlocked execution because each layer waited on the other. Loops
now rejects new workflow loops that combine both wrappers at creation time, and
blocks retargeting a loop-level goal loop onto a workflow that also carries a
top-level goal.

Step-level goals inside workflow JSON remain valid. When a loop-level goal wraps
a workflow that still carries a legacy top-level goal, the runner strips the
workflow goal for that execution only; migrate away from the redundant wrapper
with the append-only migrator (see **Workflows** below).

## Workflows

Create a workflow JSON file:

```json
{
  "name": "repo-morning",
  "steps": [
    {
      "id": "status",
      "target": {
        "type": "command",
        "command": "git",
        "args": ["status", "--short"],
        "cwd": "/path/to/repo"
      }
    },
    {
      "id": "review",
      "dependsOn": ["status"],
      "target": {
        "type": "agent",
        "provider": "codex",
        "account": { "profile": "work", "tool": "codex" },
        "cwd": "/path/to/repo",
        "prompt": "Review the repository status and summarize concrete next actions."
      }
    }
  ]
}
```

Save, run, inspect, and schedule it:

```bash
loops workflows validate repo-morning.json
loops workflows validate repo-morning.json --preflight
loops workflows create repo-morning.json
loops workflows run repo-morning --show-output
loops workflows runs repo-morning
loops workflows inspect <workflow-run-id>
loops workflows events <workflow-run-id>
loops workflows cancel <workflow-run-id> --reason "no longer needed"
loops workflows recover <workflow-run-id>
loops create workflow repo-morning-loop --workflow repo-morning --cron "0 8 * * *"
```

Use `recover` only for interrupted `running` workflow runs whose recorded child
process is gone. Terminal `timed_out` task/event workflow runs are audit
history; use `loops routes requeue <work-item-id> --reason "<cause fixed>"`
after fixing the cause, then redeliver or drain the original task/event route.

Workflow specs are stored separately from loops. A loop can schedule a workflow, but workflow runs and step runs have their own durable rows and events. Steps run in dependency order and a scheduled workflow run is idempotent per loop slot.

For command steps, `command` is the executable when `shell` is not true. Put flags in `args`:

```json
{ "type": "command", "command": "git", "args": ["status", "--short"] }
```

Use `shell: true` only when you intentionally want shell parsing:

```json
{ "type": "command", "command": "git status --short", "shell": true }
```

## Templates And Task Events

Built-in templates turn common orchestration flows into reusable workflow JSON.
Todos-task routes are Loops-native runtime admission — see
[Runtime Boundary](docs/RUNTIME_BOUNDARY.md) for how this differs from
OpenAutomations queue ownership.
`todos-task-worker-verifier` performs one todos task and then verifies it.
`event-worker-verifier` handles any Hasna event envelope and then verifies the
handling. `bounded-agent-worker-verifier` is for recurring bounded agent work:
one worker runs a narrow objective, then a fresh verifier audits the result.
The catalog also includes `task-lifecycle`, `pr-review`, `scheduled-audit`,
`knowledge-refresh`, `report-only`, `incident-response`, and
`deterministic-check-create-task` for common operator workflows. Use
`routing-remediation` for bounded routing-doctor repair runs: it dry-runs by
default, gates `safe_auto` capacity, applies only supported
`todos doctor routing --apply` repairs when explicitly enabled, and files
a blocker evidence report plus one aggregate conversations post for
human/cross-repo/unsupported findings — never one task per finding (owner directive
2026-07-30, "routine operational alerts are not tasks").

```bash
loops templates list
loops templates render todos-task-worker-verifier \
  --var taskId=<task-id> \
  --var taskTitle="Fix parser" \
  --var projectPath=/path/to/repo \
  --var provider=codewith \
  --var authProfilePool=account001,account002,account003 \
  --var sandbox=workspace-write \
  --var todosProjectPath=/path/to/todos-project \
  --var addDirs=$HOME/.hasna/todos,$HOME/.hasna/loops
loops workflows create --template todos-task-worker-verifier \
  --var taskId=<task-id> \
  --var projectPath=/path/to/repo
loops templates render event-worker-verifier \
  --var eventId=<event-id> \
  --var eventType=knowledge.record.created \
  --var eventSource=knowledge \
  --var eventJson='{"id":"<event-id>"}' \
  --var projectPath=/path/to/repo
loops templates render bounded-agent-worker-verifier \
  --var objective="Check docs drift and queue tasks for gaps" \
  --var projectPath=/path/to/repo \
  --var provider=codewith \
  --var authProfilePool=account001,account002 \
  --var sandbox=workspace-write \
  --var worktreeMode=required
loops templates render pr-review \
  --var prUrl=https://github.com/hasna/loops/pull/123 \
  --var projectPath=/path/to/repo
loops templates render deterministic-check-create-task \
  --var projectPath=/path/to/repo \
  --var checkCommand='your deterministic check and todos upsert command'
loops templates render routing-remediation \
  --var projectPath=/path/to/repo \
  --var todosProjectPath=/path/to/todos-project \
  --var shard=0/6 \
  --var maxRepairs=25 \
  --var idempotencyKey=routing-health:repo:shard0
```

Custom reusable workflow templates live under the Loops app data directory:
`~/.hasna/loops/templates` by default, or `$LOOPS_DATA_DIR/templates` when
`LOOPS_DATA_DIR` is set. Store templates as declarative JSON files; listing,
showing, and rendering templates never executes workflow steps or mutates the
registry.

Timeout policy is explicit. Deterministic command/check steps should normally
keep finite `timeoutMs`/`idleTimeoutMs` guards so broken shell work cannot run
forever. Agentic work steps default to no wall-clock timeout in built-in
worker/verifier and task-lifecycle templates; use `timeoutMs: null` in workflow
JSON, or `--timeout none` / `--timeout unlimited` for CLI-created targets, when
a step may need hours or days. Verifier/evaluator steps add a 15 minute
`idleTimeoutMs` watchdog by default so a verifier cannot hang silently after the
worker finishes; pass `--verifier-idle-timeout none` or template variable
`verifierIdleTimeoutMs=none` only when another heartbeat is guaranteed. Use a
positive numeric `timeoutMs` only when an agentic step is intentionally bounded.

To migrate existing agentic loops, use the timeout migrator instead of editing
the database directly. Workflow loops are migrated append-only because
historical workflow runs must keep pointing at their original spec; direct
agent loops selected with `--loop` update their stored target in place for
future executions:

```bash
loops workflows migrate-agent-timeouts --loop <loop-id-or-name>
loops workflows migrate-agent-timeouts --loop <loop-id-or-name> --apply
loops workflows migrate-goal-wrappers --loop <loop-id-or-name>
loops workflows migrate-goal-wrappers --loop <loop-id-or-name> --apply
loops workflows migrate-goal-wrappers --loop <loop-id-or-name> --apply --archive-old
```

Both migrators dry-run by default. For eligible non-running workflow loops,
`--apply` creates a new workflow spec and retargets only future executions;
historical workflow runs keep pointing at their original spec. For direct agent
loops selected with `--loop`, `migrate-agent-timeouts --apply` updates the
stored target in place for future executions. Use `--archive-old` to archive
superseded workflow specs when no active loops still reference them.

`migrate-agent-timeouts` clones the workflow with the requested agent timeout
policy (`--timeout none` by default). `migrate-goal-wrappers` targets loops that
define both a loop-level goal and a redundant workflow-level top-level goal: it
clones a goal-free workflow spec, retargets the loop, and leaves the loop-level
goal as the sole orchestration wrapper. Loops with only a workflow-level goal or
only a loop-level goal are skipped.

Use `loops workflows recover` only for interrupted `running` workflow runs
whose recorded child process is gone; terminal `timed_out` runs must be
requeued with `loops routes requeue <work-item-id> --reason "<cause fixed>"`
before re-delivering or draining the original task/event route.

```json
{
  "id": "custom-report",
  "name": "Custom Report",
  "description": "Run a custom report workflow from the local template registry.",
  "kind": "workflow",
  "variables": [
    { "name": "objective", "required": true, "description": "Report objective." },
    { "name": "projectPath", "required": true, "description": "Working directory." }
  ],
  "workflow": {
    "name": "custom-report-${objective}",
    "steps": [
      {
        "id": "worker",
        "target": {
          "type": "agent",
          "provider": "codewith",
          "prompt": "/goal ${objective}\nProduce the requested report only.",
          "cwd": "${projectPath}",
          "configIsolation": "safe",
          "permissionMode": "bypass",
          "sandbox": "workspace-write",
          "timeoutMs": null
        },
        "timeoutMs": null
      }
    ]
  }
}
```

```bash
loops templates validate ./custom-report.json
loops templates import ./custom-report.json
loops templates list --source custom
loops templates show custom-report
loops templates render custom-report \
  --var objective="Check docs drift" \
  --var projectPath=/path/to/repo
loops workflows create --template custom-report \
  --var objective="Check docs drift" \
  --var projectPath=/path/to/repo
```

Use `--source builtin`, `--source custom`, or `--source all` on
`templates list`, `templates show`, `templates render`, and
`workflows create --template` when automation needs an explicit source. Custom
template ids and names cannot override built-ins.
Custom templates fail closed for `danger-full-access`, dangerous passthrough
arguments, and implicit Codewith/Codex full-access defaults. If a custom
Codewith/Codex template uses `permissionMode: "bypass"`, it must also set
`sandbox` to `workspace-write` or `read-only`. Use built-in templates with
explicit break-glass handling for emergency workflows that need full access.
Claude, Cursor, AI Copilot, and OpenCode bypass modes always require explicit
break-glass plus a non-empty safety reason.

For event-driven task automation, `loops routes create todos-task` reads a
Hasna event envelope from stdin or `HASNA_EVENT_JSON`, records a
`WorkflowInvocation`, upserts an admission work item, and admits that work item
into a deduped one-shot workflow loop when route capacity allows:

```bash
cat task-created-event.json | loops routes create todos-task \
  --template task-lifecycle \
  --provider codewith \
  --auth-profile-pool account001,account002,account003 \
  --permission-mode bypass \
  --sandbox workspace-write \
  --todos-project /path/to/todos-project \
  --add-dir "$HOME/.hasna/todos,$HOME/.hasna/loops" \
  --worktree-mode required
```

Task routing is explicit opt-in. The handler skips the event without creating a
workflow unless the event data or metadata has `route_enabled=true`,
`automation.allowed=true`, or a task tag containing `auto:route`. It also skips
blocked, completed/done, cancelled/canceled, failed, archived, manual,
approval-required, or `no-auto` tasks. Terminal route work items such as
failed, dead-letter, cancelled, or succeeded history are re-admitted only when
the todos task is still actionable, the per-attempt backoff has elapsed, and the
redispatch cap has not been reached. Operators can still force a retry with
`loops routes requeue <work-item-id> --reason "<cause fixed>"`. The next
route-created output records `requeue` evidence with the previous work item id,
previous attempts, reason, new attempt, workflow id, and loop id.
Route work items are the durable reservation ledger: they include the stable
idempotency key, task/event references, project/group keys, admitting machine
ID, route scope, workflow/loop IDs, and the current terminal or active status.

Task route drains can select providers from task metadata instead of running one
fixed provider/account pool for the whole drain. Add one or more
`--provider-rule field=value:provider[:profile1,profile2]` flags; the first
matching rule wins. Rule profiles become a Codewith auth-profile pool for
`provider=codewith` and an OpenAccounts account pool for other providers. Tasks
can also carry `provider_hint`/`route_provider`, `auth_profile_pool`, or
`account_pool` metadata. Dry-run, drain evidence, and route invocation scope
include `providerRouting` so operators can see why a provider/account was
selected. Selector values may contain `:`; the parser treats the colon before a
supported provider id as the route delimiter, so exact tag selectors such as
`tags=area:frontend:claude:account003,account015` and
`tags=provider:claude-code:claude:account003,account015` match literal task
tags `area:frontend` and `provider:claude-code`.

```bash
loops routes drain todos-task \
  --dry-run \
  --provider-rule tags=area:frontend:claude:account003,account015 \
  --provider-rule tags=provider:claude-code:claude:account003,account015 \
  --provider-rule area=frontend:claude:claude-ui-a,claude-ui-b \
  --provider-rule area=backend:codewith:account001,account002 \
  --provider-rule tags=task-lifecycle:codewith:account001,account002 \
  --worktree-mode required
```

PR approval or merge tasks that need a branch-protection review must carry
explicit non-author GitHub reviewer evidence before a worker is created. When a
task has a PR reference plus `reviewDecision=REVIEW_REQUIRED`,
`mergeStateStatus=BLOCKED`, branch-protection review language, or similar
approval/merge intent, routing is skipped unless `--github-reviewer`,
`--github-reviewer-pool`, or task metadata such as `github_reviewer` /
`github_reviewer_pool` names at least one GitHub login different from the PR
author. This blocks self-review routes before they can spawn an impossible
worker, and dry-run/admission JSON includes `prReviewRouting` evidence.

By default, `todos-task` routes use `todos-task-worker-verifier` for backwards
compatibility. Use `--template task-lifecycle` to run the full triage ->
planner -> worker -> verifier lifecycle. The route rejects unrelated templates
such as `pr-review` so a todos task cannot accidentally use the wrong contract.
The default worker/verifier template starts with a deterministic
`source-task-gate` command that runs `todos --json inspect <task-id>` before the
worker, adding `--project <source-store>` only when `--todos-project` or
`LOOPS_TASK_PROJECT` supplied a Todos-owned project. `LOOPS_DATA_DIR` remains a
Loops-only setting and is never reused as a Todos project. If the routed source
task cannot be resolved, the workflow fails before repo-mutating agent work
starts.
The lifecycle template adds deterministic gates after triage and planning. If
either step marks the task blocked, omits its contextual
`openloops:triage=go task=<id> event=<event-id>` /
`openloops:planner=go task=<id> event=<event-id>` marker comment, or the task
is blocked/completed/done/cancelled/failed/archived/no-auto/manual/
approval-required, the worker step is not started. Use
`--triage-auth-profile`, `--planner-auth-profile`, `--worker-auth-profile`, and
`--verifier-auth-profile` when exact Codewith profiles are needed, or use
`--auth-profile-pool` for deterministic role rotation.

For other Hasna apps that expose `@hasna/events` webhooks, use the generic
handler:

```bash
cat event.json | loops routes create generic \
  --provider codewith \
  --auth-profile-pool account001,account002,account003 \
  --permission-mode bypass \
  --sandbox workspace-write \
  --project-path /path/to/repo \
  --worktree-mode required
```

This is the intended deterministic-to-agentic path: a producer creates a todos
task, `@hasna/events` delivers `task.created`, Loops records the invocation
and admission item, Loops creates a worker/verifier workflow when admitted,
and the workflow updates todos with evidence. Use account pools so worker and
verifier steps do not burn the same profile. For live Codewith drains, Loops
spreads each route to the **least-loaded** pool account (counting running steps
per account) and still keeps the verifier on a different profile than the worker;
the deterministic hash is the tie-break, so a cold store reproduces the previous
assignment exactly. `--max-per-profile <K>` (default 2 for pools of two or more,
`0` to disable) defers a route when every pool account already has `K` running
steps — the guardrail that keeps higher concurrency from stacking on one
subscription and tripping provider-side rate limits. The chosen account per role
is recorded on each step (`account_profile`) and surfaced in drain reports.
Use `--dry-run` to inspect the rendered invocation, work item, workflow, and
loop input without storing anything.

Generated worker/verifier workflows fail closed when `sandbox=danger-full-access`
is requested without both `manualBreakGlass=true` and a non-empty
`safetyReason`. Use `workspace-write` for unattended task/event routes. Full
access is an explicit manual emergency path, not a default automation mode.

When a sandboxed Codewith/Codex worker must update app stores outside the repo
worktree, pass those stores explicitly with `--add-dir` or template `addDirs`.
For task-created routes, pass `--todos-project` or set `LOOPS_TASK_PROJECT` when
worker/verifier commands must pin a specific Todos project. If neither is set,
Loops omits `--project` instead of inventing one from the routed repository or
`LOOPS_DATA_DIR`. Repo routing and worktree isolation still use the repository
path. `addDirs` is intentionally accepted only for Codewith/Codex until other
providers expose equivalent directory-scoped write controls.

Inspect route state with:

```bash
loops routes policies list
loops routes policies show oss
loops routes policies render oss
loops routes policies validate
cat task-created-event.json | loops routes preview todos-task --sandbox workspace-write
cat task-created-event.json | loops routes create todos-task --sandbox workspace-write
loops routes drain todos-task --task-list oss --max-dispatch 2 --compact
loops routes schedule todos-task route-drain-oss-5m --every 5m --task-list oss --max-dispatch 1 --compact
loops routes list --route-key todos-task
loops routes show <work-item-id>
loops routes requeue <work-item-id> --reason "fixed upstream blocker"
loops routes invocations
```

Named route policies let operators create and inspect recurring task-drain
routes without copying the full live command. Built-in policies are
`repoops-pr-queue`, `oss`, `pilot`, and `machine-sync`:

```bash
loops routes policies render oss
loops routes schedule todos-task machine-oss-task-lifecycle-router --policy oss
```

Scheduling with a policy stores explicit route drain args plus
`--route-policy-evidence <id>` instead of replaying `--policy`, so audits can see
the exact task list, filters, account pool, throttles, worktree mode, evidence
directory, and name prefix used for future runs. The `pilot` policy is a manual
break-glass lane using `danger-full-access`; applying it requires an explicit
`--manual-break-glass`.

For OSS task-created routing, use a deterministic drain instead of tmux
dispatch:

```bash
loops routes schedule todos-task oss-task-route-drain \
  --every 5m \
  --todos-project /path/to/todos-project \
  --template task-lifecycle \
  --project-path-prefix "$HOME/workspace/example/opensource" \
  --tags auto:route \
  --provider codewith \
  --auth-profile-pool account001,account002,account003 \
  --add-dir "$HOME/.hasna/todos,$HOME/.hasna/loops" \
  --project-group oss \
  --max-dispatch 2 \
  --scan-limit 5000 \
  --max-active-per-project 1 \
  --max-active-per-project-group 4 \
  --max-active 12 \
  --provider-active-cap 6 \
  --provider-admission-check \
  --max-per-profile 2 \
  --launch-gate "pa19-controlled-launch" \
  --launch-gate-blocker "$HOME/workspace/example/opensource/codewith::2d9d931b" \
  --launch-gate-blocker "$HOME/workspace/example/opensource/loops::816e99db" \
  --worktree-mode required \
  --evidence-dir "$HOME/.hasna/loops/reports/oss-task-route-drain" \
  --compact
```

Use `--launch-gate-blocker <todos-project-path>::<task-id>` for staged
launches where a scheduled drain must create zero worker loops until explicit
blocker tasks are completed. While any blocker is still pending, in progress,
failed, cancelled, missing, or unreadable, the drain fails closed before reading
the ready queue, writes launch-gate evidence, and leaves source tasks untouched.
Scheduled route drains preserve these gate flags in their stored argv.

`--max-active` counts active routed workflows **per route**. Scope precedence:
an explicit `--max-active-scope <key>` wins, else the running loop's
`LOOPS_LOOP_NAME`, else the route key — so each router's limit is its own
ceiling rather than a store-wide total shared by every router.
Compact drain output includes route reservation IDs, work-item status,
machine ID, workflow ID, loop ID, and route scope for each considered task.
`--max-active-per-project` and `--max-active-per-project-group` remain cross-route
anti-hog caps counted over all routes. Raise a router's `--max-active`
deliberately once counting is per-route; keep `--max-per-profile` set so the
extra concurrency spreads across subscription accounts.

Route flags or an expanded named policy are authoritative ceilings. Positive
integer task/event fields (`max_active`, `max_active_per_project`, and
`max_active_per_project_group`, including camel-case aliases) may only tighten
an already configured ceiling for that admission attempt; metadata cannot
create a cap, raise it, or override an explicit `--project-group`. Generated
workflow prompts and invocation manifests include the resolved route scope,
project group, and throttle limits so the admission decision is auditable from
the same evidence the agent sees.

These caps are local-store admission controls, not a distributed semaphore. The
count and admission write are serialized in one transaction for routers sharing
the same local `loops.db`; different `LOOPS_DATA_DIR` databases or machines do
not share project-group counts.

`--max-active` and related route throttles count Loops routed workflow work
items; they do not know whether Codewith is already at its live background-agent
admission limit. Add `--provider-active-cap <n>` (or the Codewith-specific alias
`--codewith-active-cap <n>`) to make the route run `codewith agent diagnostics
--json` before creating workflow loops and defer when `activeRunCount >= n`.
Add `--provider-admission-check` when drains should also fail closed on provider
diagnostics failure, unsupported providers, or Codewith reports with no
available admission slots. Backlog prioritizer and drain loops should use these
first-class flags instead of shell-wrapping a temporary diagnostics guard.

Only route tasks that explicitly opt in with `auto:route`, `route_enabled=true`,
or `automation.allowed=true`. Use Codewith account pools, required worktrees,
max-active throttles, and bounded evidence directories. Do not dispatch or paste
task prompts into tmux panes. Keep `--scan-limit` large enough for the local
ready-task backlog; otherwise low-priority or newly-created tasks can sit beyond
the scanned window. Generated one-shot task/event route workflow specs are
archived automatically when their workflow run reaches a terminal state;
workflow run history and manifests are preserved.

Workflow run manifests are written under
`.hasna/loops/runs/<project-slug>/<subject-key>/<run-id>/manifest.json`.
`subject-key` is a safe derived path segment, not the raw subject reference.

## OpenAutomations Runtime Binding

Loops executes automations that external compilers have materialized; it
does not own the automation product surface. See
[Runtime Boundary](docs/RUNTIME_BOUNDARY.md) for the full ownership table,
three handoff paths (claim-queue, planned `@hasna/actions` upsert-one-shot, and
explicit event-envelope routing), todos-task route distinction, and
anti-patterns.

Quick reference:

```ts
import { openAutomationsRuntimeBinding } from "@hasna/loops";
const binding = openAutomationsRuntimeBinding();
// binding.handoff === "claim-queue"
// binding.eventHandoff.handlerCommand === "loops routes create generic"
```

```bash
automations queue claim --runner loops:<worker-id>
automations queue complete <action-id> --runner loops:<worker-id>
```

For explicit event workflow routing, OpenAutomations can export the normalized
event envelope and Loops can consume it through the existing generic event
route:

```bash
automations --json webhooks event <route> --body-json '<json>' \
  | loops --json routes create generic
```

This is not automation materialization in Loops. It is an explicit
event-envelope workflow handoff: OpenAutomations owns deterministic automation
specs, webhook normalization, queue state, approvals, DLQ, and replay; Loops
owns agent workflow invocation after the operator routes the envelope to
`loops routes create generic`.

Do not store automation specs in Loops, infer automation triggers from event
transport alone, or replace the OpenAutomations queue with loop/workflow rows.
When a loop or workflow is used for execution, keep `HASNA_AUTOMATIONS_DIR`
pointing at the owning OpenAutomations data root and preserve the runner id in
completion/failure calls so OpenAutomations can enforce action leases.

### Planned Workflow Upsert SDK

External compilers such as `@hasna/actions` and `@hasna/automations` should not
write Loops SQLite rows directly. The stable contract should be an
idempotent CLI/SDK upsert that accepts a fully rendered one-shot workflow loop
request and returns durable refs.

The canonical `WorkflowUpsertRequest` / `WorkflowUpsertResult` shapes and their
required semantics (dry-run/preflight/commit modes, `idempotencyKey` +
`specHash` idempotency, dispatch behavior, and redaction-before-persistence)
are specified in `docs/AUTOMATION_RUNTIME_DESIGN.md`; this README intentionally
does not duplicate that spec.

That design doc also defines the planned `@hasna/actions` target binding. The
binding reuses `ActionManifest`, `ActionInvocation`, `ActionRunStatus`,
`ActionQueueStatus`, action-owned idempotency keys, action audit events, and
dead-letter/replay records. Loops only admits and executes the handed-off
workflow, then returns workflow refs for action-owned evidence.

The same design doc covers the planned DLQ/dead-letter lifecycle, including
`loops dlq list/show/replay/resolve`, idempotent replay keys, and compatibility
rules for `@hasna/actions`.

The same design doc also defines the planned strict automation execution mode:
minimal env inheritance, scoped secret refs, enforced allowlists,
redaction-before-persistence, and provider-safe defaults for automation-created
work.

## Transcript-Driven Loops

Loops can turn long-form media or meeting transcripts into recurring workflow work when paired with `transcriber`. The template at `docs/workflows/transcript-feedback-to-loops.json` transcribes an authorized media URL, asks an agent to extract recurring loop candidates, authors workflow specs, and validates generated workflows before scheduling. Copy it into the target repo, replace `/path/to/repo` with that repo's absolute path, and provide `TRANSCRIBER_SOURCE_URL` through the runner environment or a private, uncommitted workflow copy before storing or scheduling it. Do not commit private or signed media URLs.

```bash
loops workflows validate /path/to/repo/.openloops/transcript-feedback-to-loops.json --preflight
loops workflows create /path/to/repo/.openloops/transcript-feedback-to-loops.json
loops workflows run transcript-feedback-to-loops --show-output
```

See `docs/TRANSCRIPT_LOOP_PATTERNS.md` for transcript-to-loop guardrails and example schedules for review, maintenance, CI optimization, feedback triage, and knowledge-capture loops.

## Manage

```bash
loops list
loops show <id-or-name>
loops runs <id-or-name>
loops pause <id-or-name>
loops resume <id-or-name>
loops stop <id-or-name>
loops rename <id-or-name> <new-name>
loops archive <id-or-name>
loops unarchive <id-or-name>
loops remove <id-or-name>
loops run-now <id-or-name>
```

Use `--json` for machine-readable output. Prompt bodies and run stdout/stderr are redacted by default in status output. `loops run-now` exits non-zero when the recorded run fails or times out.

`loops run-now` is connection-aware. Against the local store it claims and executes the run inline (`runNow.source` is `manual`/`ad_hoc`, and the recorded run's status sets the exit code). Against the hosted API (`HASNA_LOOPS_API_URL` + `HASNA_LOOPS_API_KEY`) it schedules the loop due now on the control plane (`runNow.source: "hosted"`, exit 0 on a successful schedule) and a bound `loops-runner` claims and executes it on its next poll — the client never runs the loop's target while connected to the hosted API.

## Health And Hygiene

```bash
loops health --json
loops health scan --include active,paused --latest-run --doctor --daemon --json
loops health scan --include active,paused --latest-run --doctor --daemon \
  --upsert-todos --dry-run --max-actions 5 --evidence-dir ~/.hasna/loops/reports/health-scan
loops expectations <loop-id-or-name> --json
loops health route-tasks --project ~/.hasna/loops --task-list loop-error-self-heal --max-actions 5
loops hygiene names --json
loops hygiene duplicates --json
loops hygiene scripts --json
loops hygiene route-tasks --checks duplicates,scripts --project ~/.hasna/loops --task-list openloops-hygiene
```

`health` and `expectations` classify latest-run failures with stable
fingerprints and bounded evidence. `health route-tasks` is the explicit
mutating path: it upserts deduped Todos tasks for failed expectations and marks
them with `no_tmux_dispatch=true` metadata. Use `--dry-run --json` before
turning it into a production loop.

`health scan` is the first-class replacement for local loop-error self-heal
scripts. It inventories active/paused loops by default, can include doctor,
daemon, preflight, latest-run, and stale-running findings, writes bounded
`summary.json` and `report.md` files under
`$LOOPS_DATA_DIR/reports/health-scan`, and prints compact human or stable JSON
output. It is read-only unless `--upsert-todos` is supplied. The only built-in
self-heal is `--start-daemon`, which attempts to start the daemon when status
proves it is not running; it never stops, resumes, deletes, archives, or reaps
loops.

Add `--evidence-dir <dir>` to `health route-tasks` or `hygiene route-tasks`
when the deterministic loop should write a durable JSON heartbeat/report in
addition to loop stdout. Add `--auto-route` only for task lists that are
intentionally connected to task-created worker/verifier automation; it appends
`auto:route`, sets route metadata, and lets OpenTodos/OpenEvents trigger the
existing headless workflow path when the finding has a cwd or
`--route-project-path` is provided. Findings with no routeable working
directory stay as tasks and record an `auto_route_skipped_reason`. Without
`--auto-route`, the command only creates or updates deduped tasks.

`hygiene names` reports canonical `machine-*` or `repo-<name>-*` loop names and
renames only with `--apply`. Cadence/timer suffixes such as `-5m`, `-15m`,
`-6h`, `-hourly`, and `-daily` are removed from canonical names; cadence belongs
in the schedule metadata and the human `loops list` `cadence=` column. Apply
mode writes a SQLite backup under `<LOOPS_DATA_DIR>/backups` before changing loop
names. New loops get a compact default description with Why/How/Outcome text
unless the operator supplies `--description`. `hygiene duplicates` groups loops
with the same normalized name, cwd, and schedule. `hygiene scripts` inventories
loops whose command still references `~/.hasna/loops/scripts`.
`hygiene route-tasks` upserts deduped Todos tasks for hygiene findings with
stable fingerprints and `no_tmux_dispatch=true` metadata. Route commands use a
package-managed cursor under `<LOOPS_DATA_DIR>/route-cursors.json` so bounded
`--max-actions` runs advance through all findings over repeated scheduled runs
instead of reprocessing only the first batch.

Use `loops rename` for deliberate operator naming changes that should not be
encoded as automatic hygiene policy:

```bash
loops rename machine-todos-drain-oss-repos-strict-5m machine-todos-drain-oss-repos
loops --json rename <loop-id> machine-ops-loop-health-route-tasks
```

`rename` preserves the loop id, schedule, run history, archive state, and target
configuration. It rejects empty or duplicate names and writes a SQLite backup
under `<LOOPS_DATA_DIR>/backups` before mutating the loop row. Keep cadence in
schedule metadata and operator tables rather than in the loop name when the name
is meant for humans.

Archive loops when retiring old automation but preserving history:

```bash
loops archive <id-or-name>
loops list --archived
loops list --all
```

Archived loops are hidden from the default `loops list`, excluded from daemon scheduling and doctor preflight, and cannot be run manually until restored with `loops unarchive`. `loops remove` deletes the loop record and its run history (including run receipts on the hosted control plane); prefer `archive` for superseded loops that may need audit history. On the hosted control plane (`connection=api`), `DELETE /v1/loops/{id}` returns 200 with `{ deleted: true }`, or 404 `loop_not_found` for unknown ids (hasna/apps #1233) — run receipts are deleted inside the same transaction, so loops that produced terminal receipts delete cleanly.

`loops run-now` reports the manual run source:

- `source=ad_hoc`: the loop was not due yet, so Loops created a one-off manual slot. This is a single immediate attempt and does not schedule retries or consume the future scheduled slot.
- `source=due_slot`: the persisted scheduled slot was already due, so the manual run claims that slot and advances or retries the loop using normal scheduler rules.
- `source=retry_slot`: the loop was waiting on a failed slot retry, so the manual run claims that retry slot and advances the loop using normal retry rules.

## Daemon

```bash
loops daemon start
loops daemon status
loops daemon logs
loops daemon stop
loops doctor
```

Run in the foreground for supervised environments:

```bash
loops daemon run
```

Install startup integration:

```bash
loops daemon install
loops daemon install --enable
```

On Linux this writes a user systemd service. On macOS it writes a LaunchAgent plist. The command prints the exact enable/load commands to run. `--enable` runs the user-service enable/start command when supported.

## Scheduling Contract

- `once`: one run at an absolute date/time.
- `interval`: fixed-rate by default. The next slot is based on the scheduled slot, then advanced past the completion time to avoid hot-looping after downtime.
- `cron`: five-field cron expression using the host local timezone.
- `dynamic`: one-minute cadence by default and no backfill.
- `catch_up=latest` by default: downtime coalesces missed interval/cron slots to the latest eligible slot.
- `catch_up=all`: runs up to `catch_up_limit` missed slots.
- `catch_up=none`: runs only the persisted next slot.
- `overlap=skip` by default: a due slot records a skipped run if a previous run is still active.
- Each run is keyed by `(loop_id, scheduled_for)` so a slot is claimed once.
- Failed slots retry only when `--attempts` is greater than `1`; retries keep the original `scheduled_for` value.
- Failed ad-hoc manual `run-now` slots are single attempts and do not schedule retries. Due-slot and retry-slot manual runs use normal retry behavior.
- Running rows have leases. If a daemon dies, a later daemon marks expired running rows as `abandoned`.

## Runner Key Provisioning

Runner routes (`runs.claim`, `runs.heartbeat`, `runs.finalize`, …) require a
**machine-kind** API key bound to a tenant and to a machine principal whose id
equals the runner's machine id — a hand-minted client key is rejected with
`403 wrong_token_kind`. `loops-serve provision-runner-key` is the repeatable
path that provisions exactly that binding, and it is idempotent: when the
runner principal already exists as an active machine principal holding an
active, unexpired machine-kind key, it prints the existing key's id and
expiresAt and mints nothing (a second token is never minted).

```bash
HASNA_LOOPS_MIGRATOR_DATABASE_URL=<database-url> \
HASNA_LOOPS_API_SIGNING_KEY=<signing-secret> \
loops-serve provision-runner-key \
  --runner-id "$(hostname)" \   # must equal the runner's machine id
  --tenant-id <tenant-id> \     # or set HASNA_LOOPS_TENANT_ID
  --token-out /run/loops/runner.env   # mode 600; or --print-token
```

stdout carries exactly `{"runnerId","kid","expiresAt"}` — the minted token
itself goes only to the `--token-out` file (created mode 600) or, when
`--print-token` is passed explicitly, to stdout as its own trailing line. The
token is never logged. Defaults: roles `worker,service`, scope `loops:runner`,
ttl 365 days. Rerunning with the same `--runner-id` is a no-op (same kid) and
delivers no token — pass a fresh `--token-out` path or `--print-token` only
when a new key was actually minted.

On the hosted control plane this runs as a one-off command in the migrator
EC2/ECS task family (same `HASNA_LOOPS_MIGRATOR_DATABASE_URL` and
`HASNA_LOOPS_API_SIGNING_KEY` the migrate verb uses), and the emitted file is
installed into the station's mode-600 runner env.

## Runner Claim Scope

A loop that names no machine is claimable by any runner. That is the default and
it is what makes a single carrier able to run the fleet's unpinned work — but it
also means a second runner started anywhere will drain that same work onto
itself. `--claim-scope` lets a runner opt out.

```bash
loops-runner run-once --claim-scope bound     # only loops pinned to this runner
loops-runner run       --claim-scope bound
LOOPS_RUNNER_CLAIM_SCOPE=bound loops-runner run
```

- `fleet` (default) claims machine-unbound loops as well as loops pinned to this
  runner. Sending nothing is identical to sending `fleet`, so every runner
  predating this option keeps its exact behaviour.
- `bound` claims only loops pinned to this runner. Loops pinned elsewhere and
  machine-unbound loops are both left alone.

Enforcement is entirely server-side: the runner executes whatever the claim
response hands it, so upgrading a runner against an older control plane changes
nothing about what it claims. A `bound` runner therefore checks the open
`/version` probe for the `runner.claimScope` capability **before** its first
claim and refuses to claim at all if the control plane does not advertise it,
because there is no unclaim endpoint — a run claimed by mistake is held until
its lease expires. It also asserts that the server echoes the scope back on
every claim response, since a capability list can drift from what the server
actually parses.

An unrecognised value is rejected (`invalid_claim_scope`, HTTP 422) rather than
falling back to the permissive default: a typo that answered 200 and drained the
fleet anyway is the failure this option exists to prevent.

## Runner Failure Episodes

A runner whose every claim/poll fails knows the control plane is broken long
before anyone else does — and historically all it could do was write one opaque
journal line per poll, losing even the in-memory streak whenever a oneshot
timer exited. Failure episodes fix that: the streak is persisted, one episode
opens per outage, and exactly one structured event is emitted when it opens and
one when the plane recovers.

- **State** lives in `<dataDir>/runner-episodes.json` (`LOOPS_DATA_DIR`, else
  `~/.hasna/loops`), written atomically (tmp + rename), and survives process
  exits — a oneshot timer that restarts every poll continues the same streak.
- **Open**: after 3 consecutive claim/poll failures whose streak spans at least
  120s. Further failures update the counts silently — no repeated events, no
  duplicates, ever.
- **Close**: after 2 consecutive successful polls, with one recovery event. A
  recovery is never emitted before its still-undelivered open event.
- **Exactly-once events**: the episode id is deterministic (derived from the
  streak's persisted `firstFailureAt` and the runner id), outbox appends are
  idempotent per `(event, episodeId)`, and each state update runs under a
  short-lived lock file. Delivery is **state-first**: the pending episode (and
  pending recovery) is persisted BEFORE the outbox append, so the outbox can
  never hold an event the state file does not know about — every crash window
  converges to one open + one recovery event, with the pending delivery
  retried on the next poll. Delivery confirmation lives in the state file:
  each append attempt records the outbox offset where it began
  (`pendingAppend`), and a retry scans exactly the bytes appended since that
  offset — the only region that can hold the attempted line — so dedup is
  exact (no duplicates however large the outbox grows) and never reads the
  outbox history. The notifier fires only when the event is freshly appended.
  Locks carry the acquirer's token and are released only by their owner (a
  displaced holder can never delete the successor's lock), stale-lock takeover
  uses an atomic rename (exactly one contender wins), and lock contention is a
  short bounded retry (µs-scale critical sections) followed by skipping that
  update — except successes, which are persisted and drained under the lock so
  no recovery transition is ever dropped. Episode tracking never meaningfully
  delays a poll.
- **Failure classes** are `connectivity | http_5xx | auth | contract | refusal`,
  derived only from safe signals (this package's own error types and the numeric
  HTTP status). Episode state and events never contain error text, request
  bodies, URLs, or credentials — foreign errors stay opaque here exactly as
  they do in the journal logger, and the runner id is validated against a
  conservative identifier shape before it reaches any durable surface
  (anything else is recorded as `unknown` in full, never partially masked).

### Escalation binding contract (delivery is not a package dependency)

The package owns **detection** plus a generic, best-effort delivery hook. It
deliberately has no hardcoded destination — no channel, no incident tool, no
network call of its own. A deployment binds delivery through:

1. **Outbox file** (durable, always on): every event is appended as one JSON
   line to `<dataDir>/runner-events.outbox.jsonl`. An external relay consumes
   it; if the file is unwritable the episode state stays `open_pending` and
   delivery is retried on the next poll.
2. **Notifier command** (optional): when `LOOPS_RUNNER_NOTIFIER_CMD` is set, the
   runner spawns it detached (`sh -c <command>`) with one event JSON object on
   **stdin** and ignores everything about the result — exit code, stderr, even
   whether it exists. A notifier that fails, hangs (killed after 30s), or is
   unconfigured never blocks, slows, or fails a poll.

Event shapes (one JSON object per line):

```json
{"evt":"loops_runner_control_plane_unreachable","episodeId":"ep_…","runnerId":"runner-1","firstFailureAt":"…","lastFailureAt":"…","openedAt":"…","consecutiveCount":3,"failureClass":"connectivity","lastSuccessAt":null}
{"evt":"loops_runner_control_plane_recovered","episodeId":"ep_…","runnerId":"runner-1","firstFailureAt":"…","openedAt":"…","recoveredAt":"…","consecutiveCount":822,"failureClass":"connectivity","outageMs":58080000}
```

The same lines go to the runner's stderr journal, so `journalctl` shows the
episode within one streak window.

## Agent Adapter Notes

The adapters intentionally use provider command surfaces instead of pretending every agent has one SDK:

- Claude uses `claude -p --output-format json` and safe-mode/local setting sources by default.
- Codewith runs non-interactive `codewith --ask-for-approval never exec --json` sessions by default. exec starts a fresh session per invocation, avoiding the multi-megabyte rollout history that `codewith agent start` reloaded every turn (which drove `context_length_exceeded` silent no-ops), and it keeps network egress for gh/git — the `workspace-write` sandbox opts back into `sandbox_workspace_write.network_access`. Codewith exec is remote-capable like codex.
- AI Copilot and OpenCode use `run --format json --pure`. OpenCode requires an explicit provider/model id because ambient OpenCode config is machine-specific.
- Cursor is CLI-first for now via the standalone `agent -p` binary. Loops no longer falls back to `cursor agent`; install the standalone Cursor Agent CLI so preflight and scheduled runs use the same executable.
- Codex uses `codex --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories where supported.
- Agent prompts are sent through child stdin instead of argv where the provider supports stdin, including Codewith `exec` (which reads instructions from stdin when no positional prompt is given), so the prompt never lands on argv.
- When `--account` or a step `account` is set, Loops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native Codewith selectors passed as `--auth-profile <name>` on the `exec` invocation; they do not call OpenAccounts. Local and remote preflight share the JSON-first, exact-name contract described above, use human-table parsing only as a compatibility fallback, and fail closed for unusable or missing profiles, NUL-containing names, and non-fallback list failures.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--allow-tool` and `--allow-command` declare advisory, metadata-only
  restrictions and require `--safety-reason`. The exact contract is persisted
  and emitted for audit, but Loops does not claim provider-side enforcement.
  Relaxed sandboxes and native provider bypass modes also require explicit
  `--manual-break-glass`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
- `extraArgs` is fail-closed: every provider currently rejects non-empty
  passthrough arguments, including unknown options, positional subcommands,
  split values, `--option=value`, and attached short-option forms. Configure
  execution, output, permissions, sandboxing, model, cwd, and other supported
  behavior through the modeled agent-target fields. A passthrough option must
  be explicitly reviewed and added to the provider allowlist before use.
  Legacy persisted targets are not silently accepted or rewritten: execution
  fails validation until `extraArgs` is removed and replaced with modeled
  fields. API and migration imports reject those targets instead of stripping
  the arguments; update the source record and retry the import.
- `--variant` is provider-specific reasoning/model effort. Claude maps it to `--effort`, Codewith/Codex map it to `model_reasoning_effort`, and OpenCode/AICopilot pass `--variant`.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For hosted workflow runs, the control plane derives any required agent session
contract from the stored workflow step and persists it before execution. Reusing an
older workflow run backfills a missing valid contract idempotently. Stored
pre-contract workflows with unsafe/invalid agent options, mismatched stored
contracts, duplicate contracts, command-step contracts, and client-fabricated
contracts fail closed. Direct agent loops continue to expose their contract
through prompt/environment metadata only.

For production loops that can mutate repos, use disposable worktrees (`--worktree-mode required` / `worktreeMode=required`) and explicit prompts that name allowed write scope. Worktrees are executor-enforced: when a target carries worktree metadata, the executor prepares and enters the git worktree before spawning the child process, records the worktree it entered, and with `mode=required` fails the run closed instead of falling back to the original checkout when preparation fails. Existing managed worktrees are reused only after top-level and git-common-dir checks; a clean detached or stale-branch checkout may be reattached to the expected generated branch, while dirty or unsafe mismatches fail with cleanup evidence. Remote machine runs with a required worktree apply the same checks on the remote side before the target executes.
