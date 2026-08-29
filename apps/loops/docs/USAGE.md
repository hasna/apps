# Loops

Loops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `agent` (Cursor Agent CLI)
- `codewith exec`
- `aicopilot run`
- `opencode run`
- `codex exec`

## Storage And Connections

Loops has no deployment modes. Storage defaults to SQLite (the local file in
`LOOPS_DATA_DIR`, authoritative, executed by `loops-daemon`). The package also
ships a control-plane server, `loops-serve`, backed by PostgreSQL and selected
by `HASNA_LOOPS_DATABASE_URL`, with the embeddable `loops-api` contract shared
by serve, SDK, and tests. This release exposes storage-backed `/v1` loop CRUD
and run listing, runner claim/lease heartbeat/finalize foundations, and local
migration previews. Durable runner registration is not exposed until the
machine-record lifecycle is implemented. Control-plane clients require
`HASNA_LOOPS_API_URL` plus `HASNA_LOOPS_API_KEY` before status can report
ready.

`loops status` reports the storage backend and the client connection
(`storage=sqlite|postgresql`, `connection=file|api`). Scheduler state is
explicit in status JSON: `schedulerState.localStore` is SQLite plus local run
artifact files, authoritative on the file connection;
`schedulerState.remoteStore` names the configured control-plane contract
(`api_control_plane_contract`, `postgres_contract`, or
`hosted_control_plane_contract`). The standalone `loops` CLI reports
`applySupported=false` for control-plane apply because it does not perform
id-preserving remote migration, S3/object storage mutation, AWS resource
mutation, or hosted credential mutation. `loops-serve` mutates Postgres for
normal control-plane CRUD and runner protocol routes when it is explicitly
configured. Route admission remains bounded by `max_dispatch`, `max_active`,
`max_active_per_project`, `max_active_per_project_group`, `max_active_scope`,
and `max_per_profile`.

Useful status and setup commands:

```bash
loops status
loops --json status
loops migrate --dry-run
loops push --dry-run
loops pull --dry-run
loops-serve version
HASNA_LOOPS_MIGRATOR_DATABASE_URL=... loops-serve migrate --dry-run
HASNA_LOOPS_DATABASE_URL=... HASNA_LOOPS_AUTH_DATABASE_URL=... loops-serve serve
loops-runner status
```

## Migration And Sync

Export a supported local bundle:

```bash
loops export --file ./loops-export.json
loops export --file ./loops-export.json --dry-run
```

Preview and apply it into another local store:

```bash
loops import ./loops-export.json
loops import ./loops-export.json --apply
```

`loops import` is dry-run by default and prints row actions (`insert`,
`update`, `skip`, `conflict`, `blocked`) with hashes and reasons. `--apply`
creates a SQLite backup first. Existing ids are not overwritten unless
`--replace` is used and the dry-run has no conflicts or blockers.

No-loss export/import currently preserves workflow specs, loop definitions, and
terminal loop run history. It intentionally blocks when unsupported durable
tables contain rows (workflow invocations/work items, workflow run/step/event
history, goal history) or when active runtime ownership exists (active daemon
leases, running runs, leased work items). Inline command env values are not
exported as secrets; bundles with redacted env values require
`--allow-redacted` and are marked non-importable.

Self-hosted sync commands compare local definitions with the control-plane API.
`push` can apply through the id-preserving `/v1/import` endpoint; `migrate` and
`pull` remain preview/blocked for remote state that lacks a full export surface:

```bash
loops migrate --dry-run
loops push --dry-run
loops push --apply --manifest-file ./self-hosted-push.json
loops pull --dry-run
```

Self-hosted push is safe by default: workflows are archived and loops are
paused with scheduling pointers cleared, including existing same-id rows that
need re-neutralizing. `--replace` permits broader same-id data updates, but is
not required for that safety normalization. `loops-runner run-once` uses the
current bounded non-workflow
claim/execute/finalize protocol. Durable runner registration is intentionally
absent until the control plane persists and verifies machine records.
`loops-serve migrate` applies the Postgres schema and `api_keys` table for a
self-hosted control-plane host.

## Install

**Loops requires the [Bun](https://bun.sh) runtime (`bun >= 1.0`).** The
installed binaries are `loops`, `loops-daemon`, `loops-serve`, `loops-runner`,
and `loops-mcp`; each uses a `#!/usr/bin/env bun` shebang. The embeddable API
remains available as `@hasna/loops/api`.

From npm:

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

### Expiry: `--expires-at` and `--expires-after-runs`

Loops stop scheduling on either of two independent conditions:

```bash
# stop after a wall-clock time
loops create command repo-status --every 1m --cmd "git status --short" --expires-at 2026-09-01T00:00:00Z

# stop after N consecutive successful runs (e.g. a check loop that retires
# after 7 clean runs)
loops create agent weekly-audit \
  --provider claude \
  --cron "0 8 * * 1" \
  --cwd /path/to/repo \
  --prompt "Audit and fix what needs fixing." \
  --expires-after-runs 7
```

`--expires-at <time>` expires the loop after an absolute time; the daemon
checks it on every tick and marks the loop `expired`. `--expires-after-runs
<n>` expires the loop after `<n>` consecutive successful runs (run status
`succeeded` — the provider exited 0 with output). The two flags are
independent and may be combined.

Run-count expiry mirrors the circuit breaker:

- a successful run advances the streak; a final failure (retry budget
  exhausted) resets it;
- retryable failures (`attempt < maxAttempts`) and `skipped` runs are
  neutral — they neither advance nor reset the streak;
- when the loop expires, an expiry marker run is recorded in the run history,
  and `loops resume <name>` starts a fresh streak instead of re-expiring the
  loop on the next success.

Note: "success" is the run's exit status. Findings are not representable in
the run record today, so a command check loop that exits 0 counts as
successful even when it found nothing — a no-findings check loop expires
after N clean runs, which is the intended use. A check loop that fails (e.g.
`--cmd` exits non-zero when findings exist) keeps resetting the streak and
never expires this way.

Validate the target before storing the loop:

```bash
loops create command repo-status \
  --every 1m \
  --cmd git \
  --no-shell \
  --preflight
```

`--preflight` is available on `loops create command`, `loops create agent`,
`loops create workflow`, `loops workflows create`, and route commands such as
`loops routes create todos-task` and `loops routes create generic`. It checks
target executables and configured account profiles before loop or workflow rows
are stored, so a missing command, provider binary, OpenAccounts profile, native
Codewith auth profile, or workflow step dependency fails without creating a
scheduled loop. Use `--json` with `--preflight` to capture stable machine-readable
preflight evidence.

For Codewith `--auth-profile` and workflow `authProfile`, local and remote
preflight first request `codewith profile list --json` and match the requested
name exactly against the root `data` or `profiles` inventory. That inventory is
authoritative: `usable: false` rejects a profile, legacy entries without
`usable` remain usable, and `currentProfile` does not add inventory membership.
Loops falls back to the human-readable table, including active `*` rows,
only when JSON mode is unsupported or its inventory is structurally
unavailable. Embedded NUL bytes, missing profiles, and non-fallback
profile-list failures fail closed.

For shell command loops, preflight can only verify the shell plus configured
accounts because the command string is interpreted later by the shell. Use
`--no-shell` or workflow command `args` when you need executable-level
validation before storing the loop.

Use `--preflight-each-run` when a loop should repeat the same readiness check at
run time before launching expensive agent or workflow work. Runtime preflight
failures are recorded as failed loop runs with a `runtime preflight failed`
error, so health/routing checks can create follow-up tasks without spawning the
worker.

For controlled launches, scheduled todos-task drains can be guarded by blocker
tasks:

```bash
loops routes schedule todos-task platform-drain \
  --every 5m \
  --todos-project /path/to/source/todos-project \
  --tags auto:route \
  --launch-gate "pa19-controlled-launch" \
  --launch-gate-blocker "/path/to/open-codewith::2d9d931b" \
  --launch-gate-blocker "/path/to/open-loops::816e99db" \
  --worktree-mode required
```

The drain creates zero worker loops while any blocker task is not completed.
Each blocked tick writes launch-gate evidence and leaves source tasks untouched.

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
Use `--account` only when you want OpenAccounts environment isolation.

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

Agent loops can also carry an auditable advisory session contract:

```bash
loops create agent repo-check \
  --provider codewith \
  --every 15m \
  --cwd /path/to/repo \
  --prompt "Check the repo and report concrete failures." \
  --allow-tool functions.exec_command \
  --allow-command git,bun \
  --safety-reason "isolated repository status inspection"
```

These fields are stored on the loop target, appended to provider stdin, and
exposed as `LOOPS_AGENT_ALLOWED_TOOLS`, `LOOPS_AGENT_ALLOWED_COMMANDS`,
`LOOPS_AGENT_ALLOWLIST_SAFETY_REASON`,
`LOOPS_AGENT_ALLOWLIST_ENFORCEMENT=metadata_only`, and
`LOOPS_AGENT_SESSION_CONTRACT`. A direct agent loop has no workflow run and
does not create a workflow event. Agent steps inside workflow runs that carry
an audit contract additionally persist one server-derived
`agent_session_contract` event per step and run.
Tool/command restrictions remain advisory metadata: current provider adapters
do not claim native enforcement.

Codewith/Codex `danger-full-access`, Cursor `sandbox=disabled`, and provider
bypass modes (Claude, Cursor, AI Copilot, and OpenCode) require a non-empty
`--safety-reason` and either explicit `--manual-break-glass` or `--automated`.
`--automated` declares a scheduled/durable lane (for example a deploy chain)
whose relaxed access is staffed autonomously; `--manual-break-glass` remains
the path for human-initiated break-glass approval. A safety reason is always
required.

For `codewith` and `aicopilot` account isolation, register matching OpenAccounts tools first if they are not built in on the machine:

```bash
accounts tools add codewith --label "Codewith" --env-var CODEWITH_HOME --bin codewith
accounts tools add aicopilot --label "AI Copilot" --env-var AICOPILOT_CONFIG_DIR --bin aicopilot
```

## Prompt Files

Use prompt files for production agent prompts instead of long inline strings.
This keeps the durable prompt source reviewable and prevents shell history from
becoming the only copy of the prompt.

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

Workflow JSON supports `promptFile` on agent targets. Relative paths resolve
from the workflow JSON file's directory:

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

Loops stores the resolved prompt text for execution and records
`promptSource` metadata with the absolute file path. Public CLI output from
`show`, `list`, `workflows list`, `workflows show`, `workflows validate`,
`workflows create`, and `templates render` redacts prompt bodies by default
while keeping `promptSource` visible. Use
`~/.hasna/loops/prompts/<stable-name>.md` as the default prompt store for local
production loops.

Reusable custom templates cannot contain `promptFile`. Keep prompt files in
direct workflow JSON or agent loop creation; use template variables only for
non-secret routing/configuration data.

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

Gate steps can end a workflow early without failing it. A step opts into
blocked-exit semantics either explicitly via `"blockedExitCodes": [12]` on the
step, or by naming convention: a step whose `id` or `name` contains "gate" as a
standalone word (for example `gate`, `triage-gate`, `gate_check`) treats exit
code 12 as "blocked" — the step and its dependents are recorded as skipped and
the workflow still succeeds. Substring matches such as `gateway`, `aggregate`,
or `delegate` do NOT inherit gate behavior; use `blockedExitCodes` explicitly
for those. Set `"blockedExitCodes": []` on a gate-named step to opt out.

## Templates And Task Events

Loops is the runtime/scheduler/workflow engine for these flows — not the
automation domain model. Todos-task routes are Loops-native admission; they
do not replace the OpenAutomations product queue. See
[Runtime Boundary](./RUNTIME_BOUNDARY.md) for ownership split and external
compiler handoff paths (`@hasna/automations` claim-queue,
`@hasna/actions` planned upsert-one-shot).

Built-in templates turn common orchestration flows into reusable workflow JSON.
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
  --var sandbox=workspace-write
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
only a loop-level goal are skipped. New workflow loops cannot combine both
wrappers; use loop-level `--goal` on `loops create workflow` instead of nesting
a top-level `"goal"` in the workflow JSON.

Use `loops workflows recover` only for interrupted `running` workflow runs whose
recorded child process is gone; terminal `timed_out` runs must be requeued with
`loops routes requeue <work-item-id> --reason "<cause fixed>"` before
re-delivering or draining the original task/event route.

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

Repo-mutating task/event routes should set `worktreeMode=required` so the
workflow fails fast instead of falling back to the main checkout. When
`projectPath` is an existing git repository, the executor prepares and enters
a deterministic worktree under `~/.hasna/loops/worktrees/<repo>/<run>` before
spawning the worker/verifier — locally and on machine-assigned (remote) loops,
where the dispatch script runs the equivalent `git worktree add`/reuse checks
on the remote machine. The generated agent target includes worktree metadata
(`mode`, `cwd`, `path`, `branch`, `originalCwd`) so dry-runs and workflow
inspection expose the exact checkout.

Before a worker starts, worktree preparation verifies that any existing
managed path is a real git worktree with the same top-level checkout and the
same git common directory as the source repo. If the checkout is on a detached
HEAD or unexpected branch, Loops only reattaches it to the expected
generated branch when the worktree is clean. Dirty worktrees, symlinked paths,
non-worktree paths, different common dirs, and unrecoverable branch switches
fail closed with cleanup evidence (`worktreeMode=required`) instead of
silently running a mutating workflow in the wrong state; `worktreeMode=auto`
falls back to the original checkout and records the fallback.

Use explicit main/default checkout mode only when the task truly requires it:

```bash
loops templates render todos-task-worker-verifier \
  --var taskId=<task-id> \
  --var projectPath=/path/to/repo \
  --var worktreeMode=main
```

Use `worktreeMode=auto` only for compatibility or mixed routes where a
non-git/non-mutating project is expected and the fallback is recorded. Use
`worktreeMode=off` for non-git projects. `worktreeRoot` and
`worktreeBranchPrefix` can override the storage root and branch prefix.

PR review and merge route workers may fetch, rebase, or merge base branches
inside the isolated worktree when the task requires it, but they must not
mutate the primary main checkout.

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
approval-required, or `no-auto` tasks. This guard exists even when the upstream
`@hasna/events` webhook filter is misconfigured, so task existence alone is not
permission to execute agent work.
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
compatibility. Use `--template task-lifecycle` when the task should run the full
triage -> planner -> worker -> verifier lifecycle. The route rejects unrelated
workflow templates such as `pr-review` so a todos task cannot accidentally use a
template with the wrong contract.
The default worker/verifier template starts with a deterministic
`source-task-gate` command that runs `todos --json inspect <task-id>` before the
worker, adding `--project <source-store>` only when `--todos-project` or
`LOOPS_TASK_PROJECT` supplied a Todos-owned project. `LOOPS_DATA_DIR` remains a
Loops-only setting and is never reused as a Todos project. If the routed source
task cannot be resolved, the workflow fails before repo-mutating agent work
starts.
The lifecycle template inserts deterministic gate steps after triage and after
planning. If either agent marks the task blocked, omits its contextual
`openloops:triage=go task=<id> event=<event-id>` /
`openloops:planner=go task=<id> event=<event-id>` marker comment, or the task
is marked blocked/completed/done/cancelled/failed/archived/no-auto/manual/
approval-required, the next agent step is not started.
Use `--triage-auth-profile`, `--planner-auth-profile`,
`--worker-auth-profile`, and `--verifier-auth-profile` for exact Codewith role
profiles, or use `--auth-profile-pool` for deterministic role rotation.

Use route throttles to avoid stampeding agents when a producer creates many
tasks at once:

```bash
cat task-created-event.json | loops routes create todos-task \
  --provider codewith \
  --auth-profile-pool account001,account002,account003 \
  --project-group oss \
  --max-active-per-project 1 \
  --max-active-per-project-group 4 \
  --max-active 12
```

The limits count active admitted/running Loops work items once per workflow.
`--max-active-per-project` gates new work for the same project path,
`--max-active-per-project-group` shares a pool across related projects such as
`oss`, and `--max-active` is the global routed-workflow cap. Project matching
uses the canonical git top-level path when available, so repo subdirectories
share the same project cap. A throttled event records a deferred Loops
admission work item with JSON evidence instead of creating another worker loop.
Route flags or an expanded named policy are authoritative ceilings. Positive
integer task/event fields (`max_active`, `max_active_per_project`, and
`max_active_per_project_group`, including camel-case aliases) may only lower an
already configured ceiling for that admission attempt; metadata cannot create a
cap, raise it, or override an explicit `--project-group`. The resolved route
scope, project group, and limits are copied into workflow prompts and invocation
evidence.

Admission caps coordinate only through the active local SQLite store. The count
and admission write are one transaction, so concurrent routers sharing the same
`loops.db` serialize correctly. Separate `LOOPS_DATA_DIR` databases or machines
do not share counts; these flags do not provide distributed coordination.

Re-delivering the event later is safe because handlers dedupe by the work-item
idempotency key before rendering worktree plans or checking route limits. In
dry-run mode, throttle counts are not evaluated because opening the live loop
store can create or migrate the local database.
Terminal routed work items such as failed, dead-letter, cancelled, or succeeded
history are re-admitted only when the todos task is still actionable, the
per-attempt backoff has elapsed, and the redispatch cap has not been reached.
Operators can still force a retry with `loops routes requeue <work-item-id>
--reason "<cause fixed>"`. The next route-created output records `requeue`
evidence with the previous work item id, previous attempts, reason, new attempt,
workflow id, and loop id.

When a sandboxed Codewith/Codex worker must update app stores outside the repo
worktree, pass those stores explicitly with `--add-dir` or template `addDirs`.
For task-created routes, pass `--todos-project` or set `LOOPS_TASK_PROJECT` when
worker/verifier commands must pin a specific Todos project. If neither is set,
Loops omits `--project` instead of inventing one from the routed repository or
`LOOPS_DATA_DIR`. Route concurrency and worktree isolation still use the
repository path. `addDirs` is intentionally accepted only for Codewith/Codex
until other providers expose equivalent directory-scoped write controls.

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

Compact drain output includes route reservation IDs, work-item status, machine
ID, workflow ID, loop ID, and route scope for each considered task.

Named route policies expand the long recurring drain commands used by the live
task routers into explicit, replayable options. `repoops-pr-queue`, `oss`,
`pilot`, and `machine-sync` are built in. Operators can inspect the policy,
render the exact `loops --json routes drain todos-task ...` command, and validate
that the rendered args no longer depend on `--policy`/`--preset`:

```bash
loops routes policies render oss
loops routes schedule todos-task machine-oss-task-lifecycle-router --policy oss
```

Scheduled policy routes store explicit drain args plus
`--route-policy-evidence <id>`, so future runs remain auditable even if a policy
definition changes later. Policy drains and dry-runs include `routePolicy`
evidence with the source, safety class, guards, expanded options, and rendered
args. Passing a conflicting explicit option fails before the route is created.
The `pilot` policy uses `sandbox=danger-full-access` and is treated as a paused
manual break-glass lane; applying it requires the operator to pass
`--manual-break-glass` explicitly.

When a workflow run starts from an admitted work item, Loops writes a
manifest under:

```text
.hasna/loops/runs/<project-slug>/<subject-key>/<run-id>/manifest.json
```

`subject-key` is a safe derived path segment (`kind-safeSlug-shortHash`), not
the raw subject reference. The raw `subjectRef` is stored inside the manifest.

When tasks were created while capacity was full, or when bulk producers created
many tasks at once, use the drain command instead of replaying every webhook by
hand. It scans `todos ready --json`, so tasks with incomplete dependencies,
locks, or non-pending states stay queued in todos and are not routed:

```bash
loops routes drain todos-task \
  --todos-project /path/to/todos-project \
  --template task-lifecycle \
  --task-list repoops-pr-queue \
  --tags auto:route \
  --project-path-prefix "$HOME/workspace/example/opensource" \
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
  --worktree-mode required \
  --evidence-dir "$HOME/.hasna/loops/reports/task-drain"
```

`--max-dispatch` caps new workflow-loop creation per drain run. `--limit` caps
filtered ready-task candidates, while `--scan-limit` controls how many raw
`todos ready` rows are fetched before filters. Use `--task-list`, `--tags`,
`--todos-project-id`, and `--project-path-prefix` to keep each drain aligned
with the route/name-prefix it services. When any of those filters are set, the
default scan limit is raised to 500 so a busy shared queue is less likely to
starve project-specific drains. The route throttle flags are still checked for
every candidate, so a drain can safely run every few minutes as a deterministic
command loop: it fills only available capacity, writes compact JSON evidence
when requested, and leaves excess ready tasks in todos for a later drain pass.
Use `--dry-run` to preview candidates and rendered workflows without mutating
Loops state.

The route throttle flags count Loops routed workflow work items, not the
live background-agent slots inside a provider. For Codewith drains, add
`--provider-active-cap <n>` (or `--codewith-active-cap <n>`) so each candidate
checks `codewith agent diagnostics --json` before workflow-loop creation and
defers when `activeRunCount >= n`. Use `--provider-admission-check` when the
drain should also fail closed on diagnostics errors, unsupported providers, or
Codewith reports with no available admission slots. Backlog prioritizer and
drain loops should use these first-class flags rather than a shell guard around
`codewith agent diagnostics`.

For an OSS task-created route, keep the drain deterministic and narrow:

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
  --worktree-mode required \
  --evidence-dir "$HOME/.hasna/loops/reports/oss-task-route-drain" \
  --compact
```

Only tasks under `$HOME/workspace/example/opensource` that explicitly opt
in with the `auto:route` tag, `route_enabled=true`, or
`automation.allowed=true` should be routed. Keep repo-mutating worker/verifier
runs on a Codewith account pool with `--worktree-mode required`. Do not dispatch
or paste task prompts into tmux panes. Use max-active throttles and
`--max-dispatch` to bound Loops agent fan-out, and use
`--provider-active-cap` plus `--provider-admission-check` to bound live Codewith
background-agent admission. Write compact evidence into a bounded reports
directory so operators can audit each drain without unbounded stdout or loop
history growth. Keep `--scan-limit` large enough for the current ready-task
backlog; if the scan is exhausted before matching tasks appear, the drain will
correctly do no work.

Generated task/event route workflow specs are lifecycle-managed. After a
generated one-shot route workflow run reaches `succeeded`, `failed`,
`timed_out`, or `cancelled`, Loops archives the generated workflow spec while
preserving workflow run, step, event, manifest, loop, invocation, and work-item
history.

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
verifier steps do not burn the same profile; Loops picks deterministically
and uses a different verifier profile when the pool has at least two entries.
Use `--dry-run` to inspect the rendered invocation, work item, workflow, and
loop input without storing anything, including the worktree path and branch for
git-backed tasks.

Generated worker/verifier workflows fail closed when `sandbox=danger-full-access`
is requested without both `manualBreakGlass=true` and a non-empty
`safetyReason`. Use `workspace-write` for unattended task/event routes. Full
access is an explicit manual emergency path, not a default automation mode.

## Run Receipts

Use run receipts when an agent, scheduler, route, or external workflow needs a
stable run outcome without parsing raw stdout or wrapper-script text. Receipts
are scheduler-neutral JSON records with these public snake_case fields:
`loop_id`, `run_id`, `machine`, `repo`, `task_ids`, `knowledge_ids`,
`digest_id`, `started_at`, `finished_at`, `status`, `exit_code`, `summary`, and
`evidence_paths`. The summary contains bounded, scrubbed excerpts and byte
counts; raw unbounded stdout/stderr stays out of the receipt contract.

```bash
cat receipt.json | loops --json receipts write --file -
loops --json receipts read run_123
loops --json receipts list --loop-id loop_123 --task-id task_123
```

MCP clients can use `loops_receipt_read`, `loops_receipts_list`, and the
mutation-gated `loops_receipt_write`. The SDK exposes `writeReceipt`,
`receipt`, and `receipts`; the HTTP API exposes `POST /v1/receipts`,
`GET /v1/receipts/{runId}`, and `GET /v1/receipts`.

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
loops archive <id-or-name>
loops unarchive <id-or-name>
loops remove <id-or-name>
loops run-now <id-or-name>
```

Use `--json` for machine-readable output. Prompt bodies and run stdout/stderr are redacted by default in status output. `loops run-now` exits non-zero when the recorded run fails or times out.

## Health And Expectations

`loops health --json` summarizes the latest run for each loop and classifies
agent-run failures for default-loop SLOs:

```bash
loops health --json
loops health scan --include active,paused --latest-run --doctor --daemon --json
loops expectations <loop-id-or-name> --json
```

The JSON contains the expectation result, bounded error/stdout/stderr evidence,
a stable failure fingerprint, route metadata, and recommended task fields.
Loops does not mutate Todos from `health`, `expectations`, or read-only
`health scan`. To turn failed expectations or scan findings into deduped tasks,
use an explicit mutating command:

```bash
loops health route-tasks \
  --project ~/.hasna/loops \
  --task-list loop-error-self-heal \
  --max-actions 5

loops health scan \
  --include active,paused \
  --latest-run \
  --doctor \
  --daemon \
  --upsert-todos \
  --dry-run \
  --max-actions 5 \
  --evidence-dir ~/.hasna/loops/reports/health-scan
```

Use `--dry-run --json` first when testing a new automation path. Routed tasks
include the stable failure fingerprint, classification, loop id/name, and
`no_tmux_dispatch=true` metadata.

`health scan` replaces local loop-error self-heal scripts with package-owned
CLI/SDK/MCP primitives. It inventories included loop statuses, detects daemon,
doctor, preflight, latest-run, and stale-running issues, writes bounded
`summary.json` and `report.md` files under
`$LOOPS_DATA_DIR/reports/health-scan` or `--report-dir`/`--evidence-dir`, and
keeps output compact. It is read-only by default. The only safe self-heal is
`--start-daemon`, which starts the daemon only when status proves it is not
running; it does not stop, resume, archive, delete, or reap loops.

Use `--evidence-dir <dir>` when a deterministic loop needs a compact JSON
heartbeat/report on disk. Use `--auto-route` only on task lists that should feed
the task-created headless worker/verifier workflow; it adds the `auto:route`
tag and route metadata when the finding has a cwd or `--route-project-path` is
provided. Findings with no routeable working directory remain plain tasks and
record an `auto_route_skipped_reason`. Without `--auto-route`, route commands
only upsert deduped tasks and do not launch agents.

Failure classifications are: `rate_limit`, `auth`, `model_not_found`,
`context_length`, `schema_response_format`, `node_init`, `preflight`,
`route_functional`, `timeout`, `sigsegv`, `skipped_previous_active`,
`circuit_breaker`, and `unknown`.

## Hygiene

Loops includes deterministic hygiene checks for replacing local maintenance
scripts with package commands:

```bash
loops hygiene names --json
loops hygiene names --apply
loops hygiene duplicates --json
loops hygiene scripts --json
loops hygiene route-tasks --checks names,duplicates,scripts --dry-run --json
```

`hygiene names` reports canonical `machine-*` or `repo-<name>-*` loop names and
only renames when `--apply` is present. Cadence/timer suffixes such as `-5m`,
`-15m`, `-6h`, `-hourly`, and `-daily` are removed from canonical names; cadence
belongs in schedule metadata and the human `loops list` `cadence=` column. Apply
mode writes a SQLite backup under `<LOOPS_DATA_DIR>/backups` before changing loop
names. New loops get a compact default description with Why/How/Outcome text
unless the operator supplies `--description`. `hygiene duplicates` groups loops
with the same normalized name, cwd, and schedule. `hygiene scripts` inventories
loops whose command still references `~/.hasna/loops/scripts`; use it as a
migration gate before deleting local scripts. `hygiene route-tasks`
upserts deduped Todos tasks for hygiene findings with stable fingerprints and
`no_tmux_dispatch=true` metadata; use `--dry-run --json` before enabling it as a
production loop. Route commands store a small cursor in
`<LOOPS_DATA_DIR>/route-cursors.json` so bounded `--max-actions` runs advance
through all findings over repeated scheduled runs instead of reprocessing only
the first batch.

For a deliberate operator rename, use the first-class rename command instead of
turning a one-off naming preference into hygiene policy:

```bash
loops rename machine-todos-drain-oss-repos-strict-5m machine-todos-drain-oss-repos
loops --json rename <loop-id> machine-ops-loop-health-route-tasks
```

`rename` preserves the loop id, schedule, run history, archive state, and target
configuration. It rejects empty or duplicate names and writes a SQLite backup
under `<LOOPS_DATA_DIR>/backups` before mutating the loop row. Human-facing
names should describe scope and responsibility; cadence belongs in schedule
metadata and operator tables.

Archive loops when retiring old automation but preserving history:

```bash
loops archive <id-or-name>
loops list --archived
loops list --all
```

Archived loops are hidden from the default `loops list`, excluded from daemon scheduling and doctor preflight, and cannot be run manually until restored with `loops unarchive`. `loops remove` deletes the loop record; prefer `archive` for superseded loops that may need audit history.

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
- Agent targets that set neither `timeoutMs` nor `idleTimeoutMs` get a default
  idle watchdog: 30 minutes without stdout/stderr for streaming providers
  (codex, cursor), and 4 hours for providers whose CLIs buffer all output until
  completion (claude, opencode, aicopilot) or whose durable progress
  fingerprint can stay flat during long work (codewith). Override the default
  with `LOOPS_AGENT_IDLE_TIMEOUT_MS=<ms>`, disable it with
  `LOOPS_AGENT_IDLE_TIMEOUT_MS=0` (or `none`/`off`), or set explicit
  `timeoutMs`/`idleTimeoutMs` per target — `"timeoutMs": null` opts a target
  out of both the wall-clock default and the idle watchdog.

For hosted workflow runs, the control plane derives any required agent session
contract from the stored workflow step and persists it before execution. Reusing an
older workflow run backfills a missing valid contract idempotently. Stored
pre-contract workflows with unsafe/invalid agent options, mismatched stored
contracts, duplicate contracts, command-step contracts, and client-fabricated
contracts fail closed. Direct agent loops continue to expose their contract
through prompt/environment metadata only.

For production loops that can mutate repos, prefer the built-in
`worktreeMode=auto`/`required` path and explicit prompts that name allowed write
scope. Use `main` or `off` only for operations that intentionally need the
original checkout.
