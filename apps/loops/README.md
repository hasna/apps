# OpenLoops

OpenLoops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

Naming: the product is **OpenLoops**, published on npm as
[`@hasna/loops`](https://www.npmjs.com/package/@hasna/loops) and developed in the
[`hasna/loops`](https://github.com/hasna/loops) repository. The installed
binaries are `loops`, `loops-daemon`, `loops-api`, `loops-serve`,
`loops-runner`, and `loops-mcp`.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `agent` (Cursor Agent CLI)
- `codewith exec`
- `aicopilot run`
- `opencode run`
- `codex exec`

## Deployment Modes

OpenLoops has three deployment modes:

- `local`: SQLite in `LOOPS_DATA_DIR` is authoritative and `loops-daemon` executes scheduled work.
- `self_hosted`: the Hasna-owned AWS/RDS control-plane deployment, served by
  `loops-serve` and backed by Postgres, with the embeddable `loops-api` contract
  shared by serve, SDK, and tests. This release exposes status, storage-backed
  `/v1` loop CRUD and run listing, runner claim/heartbeat/finalize protocol
  endpoints, a one-shot `loops-runner run-once` execution path for embedded
  control-plane hosts, id-preserving local export/import, and preview-only
  self-hosted migration/sync commands; full fleet rollout and id-preserving
  remote apply are follow-up work.
- `cloud`: a hosted control-plane contract. This release exposes client/runner status only; hosted tenant auth and infrastructure live outside this package.

`local` is the default and requires no network, token, Postgres, or hosted
service. Set `LOOPS_MODE` or `HASNA_LOOPS_MODE` to `local`, `self_hosted`, or
`cloud` to choose explicitly. Without an explicit mode, `LOOPS_CLOUD_API_URL`
selects `cloud`, while `LOOPS_API_URL` or `LOOPS_DATABASE_URL` selects
`self_hosted`.

The public `@hasna/loops` package owns the local runtime, mode resolver,
self-hosted API contract, runner contract, SDK, MCP server, and CLI. Hosted
tenant auth, account administration, and infrastructure live outside this
package. Cloud mode is a public contract until a cloud-specific hosted URL and
cloud token are configured through `LOOPS_CLOUD_API_URL` plus
`LOOPS_CLOUD_TOKEN` or `HASNA_LOOPS_CLOUD_TOKEN`.

Scheduler state is explicit in status JSON. `schedulerState.localStore` is
SQLite plus local run artifact files: authoritative in `local`, cache/spool in
non-local modes. `schedulerState.remoteStore` names the non-local contract
(`api_control_plane_contract`, `postgres_contract`, or
`hosted_control_plane_contract`). The standalone `loops` CLI reports
`applySupported=false` for non-local apply because it does not perform
id-preserving remote migration, S3/object storage mutation, AWS resource
mutation, or hosted credential mutation. `loops-serve` mutates self-hosted
Postgres for normal control-plane CRUD and runner protocol routes when it is
explicitly configured. Route admission remains bounded by `max_dispatch`,
`max_active`, `max_active_per_project`, `max_active_per_project_group`,
`max_active_scope`, and `max_per_profile`.

Useful status and setup commands:

```bash
loops mode
loops --json mode
loops self-hosted status
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
loops self-hosted runner-register --runner-id <id> --machine-id <machine> --apply
loops export --file ./loops-export.json --dry-run
loops export --file ./loops-export.json
loops import ./loops-export.json
loops import ./loops-export.json --apply
loops cloud status
loops-api status
loops-serve version
HASNA_LOOPS_DATABASE_URL=... loops-serve migrate --dry-run
loops-runner status
```

See [Deployment Modes](docs/DEPLOYMENT_MODES.md) for the full package boundary
and machine-placement contract.

## Install

**OpenLoops requires the [Bun](https://bun.sh) runtime (`bun >= 1.0`).** The
`loops`, `loops-daemon`, `loops-api`, `loops-serve`, `loops-runner`, and
`loops-mcp` binaries run with a `#!/usr/bin/env bun` shebang, so Bun must be on
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

The CLI stores state in `~/.hasna/loops` by default. Set `LOOPS_DATA_DIR` to isolate state for tests or another profile.

## MCP Server

OpenLoops ships a stdio MCP server for safe loop and workflow inspection from
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
Resources are available at `loops://runtime` and `loops://tools`.
Those tools use the same `Store`, public redaction helpers, and workflow parser
as the CLI and SDK, so read output and validation behavior stay aligned across
surfaces.

Mutation tools are disabled by default. Start the server with
`LOOPS_MCP_ALLOW_MUTATIONS=true` only for a trusted local MCP host that should be
allowed to change loop state. The guarded mutation tools use canonical names:
`loops_pause`, `loops_resume`, `loops_stop`, `loops_run_now`, `loops_archive`,
`loops_unarchive`, `loops_create_command`, and `loops_create_workflow`.
Deprecated `loop_*` aliases are still registered where compatibility needs them,
but callers should use the `loops_*` names. Mutation tools do not require or
accept confirmation-string parameters; the server-side environment opt-in is the
gate. MCP `loops_run_now` schedules the loop for immediate daemon pickup; inline
execution remains CLI-only.

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

Run an OpenCode loop with an explicit provider/model. OpenCode reads
`~/.config/opencode/config.json` when no model is supplied, so OpenLoops rejects
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

OpenLoops records `promptSource` metadata and redacts prompt bodies in public
CLI output by default, including `templates render`. Use
`~/.hasna/loops/prompts/<stable-name>.md` as the default prompt store for
production loops.

Reusable custom templates cannot contain `promptFile`. Keep prompt files in
direct workflow JSON or agent loop creation; use template variables only for
non-secret routing/configuration data.

## Goals

Add `--goal` to wrap a command, agent, or workflow loop in an AI-SDK orchestration layer. OpenLoops asks the configured model to create a flat DAG plan, then executes ready plan nodes by re-running the underlying target once per node. Each node run is parameterized with that node's objective: agent prompts get the goal and node objective appended, and every wrapped process receives `LOOPS_GOAL_NODE_KEY` and `LOOPS_GOAL_NODE_OBJECTIVE` in its environment. An adversarial achievement audit runs before the goal is marked complete.

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
wrappers deadlocked execution because each layer waited on the other. OpenLoops
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
`todos-task-worker-verifier` performs one todos task and then verifies it.
`event-worker-verifier` handles any Hasna event envelope and then verifies the
handling. `bounded-agent-worker-verifier` is for recurring bounded agent work:
one worker runs a narrow objective, then a fresh verifier audits the result.
The catalog also includes `task-lifecycle`, `pr-review`, `scheduled-audit`,
`knowledge-refresh`, `report-only`, `incident-response`, and
`deterministic-check-create-task` for common operator workflows.

```bash
loops templates list
loops templates render todos-task-worker-verifier \
  --var taskId=<task-id> \
  --var taskTitle="Fix parser" \
  --var projectPath=/path/to/repo \
  --var provider=codewith \
  --var authProfilePool=account001,account002,account003 \
  --var sandbox=workspace-write \
  --var todosProjectPath=$HOME/.hasna/loops \
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
```

Custom reusable workflow templates live under the OpenLoops app data directory:
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
  --todos-project "$HOME/.hasna/loops" \
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

Task route drains can select providers from task metadata instead of running one
fixed provider/account pool for the whole drain. Add one or more
`--provider-rule field=value:provider[:profile1,profile2]` flags; the first
matching rule wins. Rule profiles become a Codewith auth-profile pool for
`provider=codewith` and an OpenAccounts account pool for other providers. Tasks
can also carry `provider_hint`/`route_provider`, `auth_profile_pool`, or
`account_pool` metadata. Dry-run, drain evidence, and route invocation scope
include `providerRouting` so operators can see why a provider/account was
selected.

```bash
loops routes drain todos-task \
  --dry-run \
  --provider-rule area=frontend:claude:claude-ui-a,claude-ui-b \
  --provider-rule area=backend:codewith:account001,account002 \
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
`source-task-gate` command that runs `todos --project <source-store> --json
inspect <task-id>` before the worker. If the routed source task cannot be
resolved in the intended Todos store, the workflow fails before repo-mutating
agent work starts.
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
task, `@hasna/events` delivers `task.created`, OpenLoops records the invocation
and admission item, OpenLoops creates a worker/verifier workflow when admitted,
and the workflow updates todos with evidence. Use account pools so worker and
verifier steps do not burn the same profile. For live Codewith drains, OpenLoops
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
is requested without `manualBreakGlass=true`. Use `workspace-write` for
unattended task/event routes. Full access is an explicit manual emergency path,
not a default automation mode.

When a sandboxed Codewith/Codex worker must update app stores outside the repo
worktree, pass those stores explicitly with `--add-dir` or template `addDirs`.
For task-created routes, pass `--todos-project` so worker/verifier prompts use
the actual todos storage project while repo routing and worktree isolation still
use the repository path. This avoids `danger-full-access` for normal todos
comments, completion state, and loop evidence writes. `addDirs` is intentionally
accepted only for Codewith/Codex until other providers expose equivalent
directory-scoped write controls.

Inspect route state with:

```bash
cat task-created-event.json | loops routes preview todos-task --sandbox workspace-write
cat task-created-event.json | loops routes create todos-task --sandbox workspace-write
loops routes drain todos-task --task-list oss --max-dispatch 2 --compact
loops routes schedule todos-task route-drain-oss-5m --every 5m --task-list oss --max-dispatch 1 --compact
loops routes list --route-key todos-task
loops routes show <work-item-id>
loops routes requeue <work-item-id> --reason "fixed upstream blocker"
loops routes invocations
```

For OSS task-created routing, use a deterministic drain instead of tmux
dispatch:

```bash
loops routes schedule todos-task oss-task-route-drain \
  --every 5m \
  --todos-project "$HOME/.hasna/loops" \
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
  --max-per-profile 2 \
  --worktree-mode required \
  --evidence-dir "$HOME/.hasna/loops/reports/oss-task-route-drain" \
  --compact
```

`--max-active` counts active routed workflows **per route**. Scope precedence:
an explicit `--max-active-scope <key>` wins, else the running loop's
`LOOPS_LOOP_NAME`, else the route key — so each router's limit is its own
ceiling rather than a store-wide total shared by every router.
`--max-active-per-project` and `--max-active-per-project-group` remain cross-route
anti-hog caps counted over all routes. Raise a router's `--max-active`
deliberately once counting is per-route; keep `--max-per-profile` set so the
extra concurrency spreads across subscription accounts.

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

OpenLoops can be used as an execution runtime for deterministic OpenAutomations
product automations, but it does not own the automation product surface.
`@hasna/automations` owns automation specs, trigger materialization, product
automation action queues, DLQ/replay, idempotency, approvals, and audit
evidence. OpenLoops owns agent workflow invocation/admission/runs. OpenLoops
only executes work that OpenAutomations has explicitly handed off; it does not
make OpenAutomations the queue owner for todos task/PR/review agent workflows.

The SDK exposes the boundary descriptor:

```ts
import { openAutomationsRuntimeBinding } from "@hasna/loops";

const binding = openAutomationsRuntimeBinding();
console.log(binding.handoff); // "claim-queue"
console.log(binding.eventHandoff.handlerCommand); // "loops routes create generic"
```

The claim-queue handoff uses the OpenAutomations CLI or SDK:

```bash
automations queue claim --runner open-loops:<worker-id>
automations queue complete <action-id> --runner open-loops:<worker-id>
automations queue fail <action-id> --runner open-loops:<worker-id> --code <code> --message <message>
```

For explicit event workflow routing, OpenAutomations can export the normalized
event envelope and OpenLoops can consume it through the existing generic event
route:

```bash
automations --json webhooks event <route> --body-json '<json>' \
  | loops --json routes create generic
```

This is not automation materialization in OpenLoops. It is an explicit
event-envelope workflow handoff: OpenAutomations owns deterministic automation
specs, webhook normalization, queue state, approvals, DLQ, and replay; OpenLoops
owns agent workflow invocation after the operator routes the envelope to
`loops routes create generic`.

Do not store automation specs in OpenLoops, infer automation triggers from event
transport alone, or replace the OpenAutomations queue with loop/workflow rows.
When a loop or workflow is used for execution, keep `HASNA_AUTOMATIONS_DIR`
pointing at the owning OpenAutomations data root and preserve the runner id in
completion/failure calls so OpenAutomations can enforce action leases.

### Planned Workflow Upsert SDK

External compilers such as `@hasna/actions` and `@hasna/automations` should not
write OpenLoops SQLite rows directly. The stable contract should be an
idempotent CLI/SDK upsert that accepts a fully rendered one-shot workflow loop
request and returns durable refs.

The canonical `WorkflowUpsertRequest` / `WorkflowUpsertResult` shapes and their
required semantics (dry-run/preflight/commit modes, `idempotencyKey` +
`specHash` idempotency, dispatch behavior, and redaction-before-persistence)
are specified in `docs/AUTOMATION_RUNTIME_DESIGN.md`; this README intentionally
does not duplicate that spec.

The same design doc covers the planned DLQ/dead-letter lifecycle, including
`loops dlq list/show/replay/resolve`, idempotent replay keys, and compatibility
rules for `@hasna/actions`.

The same design doc also defines the planned strict automation execution mode:
minimal env inheritance, scoped secret refs, enforced allowlists,
redaction-before-persistence, and provider-safe defaults for automation-created
work.

## Transcript-Driven Loops

OpenLoops can turn long-form media or meeting transcripts into recurring workflow work when paired with `iapp-transcriber`. The template at `docs/workflows/transcript-feedback-to-loops.json` transcribes an authorized media URL, asks an agent to extract recurring loop candidates, authors workflow specs, and validates generated workflows before scheduling. Copy it into the target repo, replace `/path/to/repo` with that repo's absolute path, and provide `TRANSCRIBER_SOURCE_URL` through the runner environment or a private, uncommitted workflow copy before storing or scheduling it. Do not commit private or signed media URLs.

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

Archived loops are hidden from the default `loops list`, excluded from daemon scheduling and doctor preflight, and cannot be run manually until restored with `loops unarchive`. `loops remove` deletes the loop record; prefer `archive` for superseded loops that may need audit history.

`loops run-now` reports the manual run source:

- `source=ad_hoc`: the loop was not due yet, so OpenLoops created a one-off manual slot. This is a single immediate attempt and does not schedule retries or consume the future scheduled slot.
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

## Agent Adapter Notes

The adapters intentionally use provider command surfaces instead of pretending every agent has one SDK:

- Claude uses `claude -p --output-format json` and safe-mode/local setting sources by default.
- Codewith runs non-interactive `codewith --ask-for-approval never exec --json` sessions by default. exec starts a fresh session per invocation, avoiding the multi-megabyte rollout history that `codewith agent start` reloaded every turn (which drove `context_length_exceeded` silent no-ops), and it keeps network egress for gh/git — the `workspace-write` sandbox opts back into `sandbox_workspace_write.network_access`. Codewith exec is remote-capable like codex. OpenLoops rejects Codewith `extraArgs` that try to force `exec`, `--ephemeral`, `--json`, or other exec launch flags that the adapter already manages.
- AI Copilot and OpenCode use `run --format json --pure`. OpenCode requires an explicit provider/model id because ambient OpenCode config is machine-specific.
- Cursor is CLI-first for now via the standalone `agent -p` binary. OpenLoops no longer falls back to `cursor agent`; install the standalone Cursor Agent CLI so preflight and scheduled runs use the same executable.
- Codex uses `codex --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories where supported.
- Agent prompts are sent through child stdin instead of argv where the provider supports stdin, including Codewith `exec` (which reads instructions from stdin when no positional prompt is given), so the prompt never lands on argv.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` on the `exec` invocation; they do not call OpenAccounts.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
- `--variant` is provider-specific reasoning/model effort. Claude maps it to `--effort`, Codewith/Codex map it to `model_reasoning_effort`, and OpenCode/AICopilot pass `--variant`.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For production loops that can mutate repos, use disposable worktrees (`--worktree-mode required` / `worktreeMode=required`) and explicit prompts that name allowed write scope. Worktrees are executor-enforced: when a target carries worktree metadata, the executor prepares and enters the git worktree before spawning the child process, records the worktree it entered, and with `mode=required` fails the run closed instead of falling back to the original checkout when preparation fails. Remote machine runs with a required worktree are verified fail-closed on the remote side before the target executes.
