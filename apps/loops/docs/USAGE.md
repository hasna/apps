# OpenLoops

OpenLoops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `agent` (Cursor Agent CLI)
- `codewith agent start`
- `aicopilot run`
- `opencode run`
- `codex exec`

## Deployment Modes

OpenLoops defaults to `local`, where SQLite in `LOOPS_DATA_DIR` is
authoritative and `loops-daemon` executes scheduled work. The package also
defines `self_hosted` and `cloud` contracts for future non-local control
planes:

- `self_hosted`: user-operated `loops-api` control-plane contract; this
  release exposes storage-backed API/runner foundations plus local migration
  previews.
- `cloud`: hosted control-plane contract; this release exposes client/runner
  status only, and requires `LOOPS_CLOUD_API_URL` plus `LOOPS_CLOUD_TOKEN` or
  `HASNA_LOOPS_CLOUD_TOKEN` before status can report ready.

Useful status commands:

```bash
loops mode
loops --json mode
loops self-hosted status
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
loops self-hosted runner-register --runner-id <id> --machine-id <machine>
loops self-hosted runner-register --runner-id <id> --machine-id <machine> --apply
loops cloud status
loops-api status
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

Self-hosted sync commands are preview-only until the control-plane API exposes
id-preserving import endpoints:

```bash
loops self-hosted migrate --dry-run
loops self-hosted push --dry-run
loops self-hosted pull --dry-run
```

The preview may inspect `LOOPS_API_URL`/`HASNA_LOOPS_API_URL`, but it refuses
remote apply because normal loop CRUD would generate new ids. Use
`loops self-hosted runner-register` to verify runner registration against an
API, then use `loops-runner run-once` for the current bounded non-workflow
claim/execute/finalize protocol.
Runner registration is preview-only unless `--apply` is present.

## Install

**OpenLoops requires the [Bun](https://bun.sh) runtime (`bun >= 1.0`).** The
installed binaries are `loops`, `loops-daemon`, `loops-api`, `loops-runner`, and
`loops-mcp`; each uses a `#!/usr/bin/env bun` shebang.

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

For shell command loops, preflight can only verify the shell plus configured
accounts because the command string is interpreted later by the shell. Use
`--no-shell` or workflow command `args` when you need executable-level
validation before storing the loop.

Use `--preflight-each-run` when a loop should repeat the same readiness check at
run time before launching expensive agent or workflow work. Runtime preflight
failures are recorded as failed loop runs with a `runtime preflight failed`
error, so health/routing checks can create follow-up tasks without spawning the
worker.

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

Agent loops can also carry advisory per-session allowlist metadata:

```bash
loops create agent repo-check \
  --provider codewith \
  --every 15m \
  --cwd /path/to/repo \
  --prompt "Check the repo and report concrete failures." \
  --allow-tool functions.exec_command \
  --allow-command git,bun
```

These fields are stored on the loop target and exposed to the run environment
as `LOOPS_AGENT_ALLOWED_TOOLS`, `LOOPS_AGENT_ALLOWED_COMMANDS`, and
`LOOPS_AGENT_ALLOWLIST_ENFORCEMENT=metadata_only`. They are not enforced by
OpenLoops yet; provider-native enforcement will be added separately.

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

OpenLoops stores the resolved prompt text for execution and records
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
  --var sandbox=workspace-write
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

To migrate existing workflow loops, do not edit `workflow_specs.steps_json`
directly because historical workflow runs must keep pointing at their original
spec. Use the append-only migrator:

```bash
loops workflows migrate-agent-timeouts --loop <loop-id-or-name>
loops workflows migrate-agent-timeouts --loop <loop-id-or-name> --apply
```

The command dry-runs by default. With `--apply`, it creates a new workflow spec
with the requested agent timeout policy, retargets only future executions of
eligible non-running workflow loops, and leaves terminal timed-out workflow runs
as audit history. Use `loops workflows recover` only for interrupted `running`
workflow runs whose recorded child process is gone; terminal `timed_out` runs
must be requeued with `loops routes requeue <work-item-id> --reason "<cause fixed>"` before
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
managed path is a real git worktree with the same top-level checkout, the same
git common directory as the source repo, and the expected generated branch. A
detached HEAD or unexpected branch fails closed with evidence
(`worktreeMode=required`) instead of silently running a mutating workflow in
the wrong state; `worktreeMode=auto` falls back to the original checkout and
records the fallback.

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
  --todos-project "$HOME/.hasna/loops" \
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
compatibility. Use `--template task-lifecycle` when the task should run the full
triage -> planner -> worker -> verifier lifecycle. The route rejects unrelated
workflow templates such as `pr-review` so a todos task cannot accidentally use a
template with the wrong contract.
The default worker/verifier template starts with a deterministic
`source-task-gate` command that runs `todos --project <source-store> --json
inspect <task-id>` before the worker. If the routed source task cannot be
resolved in the intended Todos store, the workflow fails before repo-mutating
agent work starts.
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

The limits count active admitted/running OpenLoops work items once per workflow.
`--max-active-per-project` gates new work for the same project path,
`--max-active-per-project-group` shares a pool across related projects such as
`oss`, and `--max-active` is the global routed-workflow cap. Project matching
uses the canonical git top-level path when available, so repo subdirectories
share the same project cap. A throttled event records a deferred OpenLoops
admission work item with JSON evidence instead of creating another worker loop.
Re-delivering the event later is safe because handlers dedupe by the work-item
idempotency key before rendering worktree plans or checking route limits. In
dry-run mode, throttle counts are not evaluated because opening the live loop
store can create or migrate the local database.
Terminal routed work items such as failed, dead-letter, cancelled, or succeeded
history remain deduped until an operator runs `loops routes requeue
<work-item-id> --reason "<cause fixed>"`; a later drain should not create
another worker just because the previous workflow ended. The next route-created
output records `requeue` evidence with the previous work item id, previous
attempts, operator reason, new attempt, workflow id, and loop id.

When a sandboxed Codewith/Codex worker must update app stores outside the repo
worktree, pass those stores explicitly with `--add-dir` or template `addDirs`.
For task-created routes, pass `--todos-project` so worker/verifier prompts use
the actual todos storage project while route concurrency and worktree isolation
still use the repository path. This avoids `danger-full-access` for normal
todos comments, completion state, and loop evidence writes. `addDirs` is
intentionally accepted only for Codewith/Codex until other providers expose
equivalent directory-scoped write controls.

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

When a workflow run starts from an admitted work item, OpenLoops writes a
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
  --todos-project "$HOME/.hasna/loops" \
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
OpenLoops state.

For an OSS task-created route, keep the drain deterministic and narrow:

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
  --worktree-mode required \
  --evidence-dir "$HOME/.hasna/loops/reports/oss-task-route-drain" \
  --compact
```

Only tasks under `$HOME/workspace/example/opensource` that explicitly opt
in with the `auto:route` tag, `route_enabled=true`, or
`automation.allowed=true` should be routed. Keep repo-mutating worker/verifier
runs on a Codewith account pool with `--worktree-mode required`. Do not dispatch
or paste task prompts into tmux panes. Use max-active throttles and
`--max-dispatch` to bound agent fan-out, and write compact evidence into a
bounded reports directory so operators can audit each drain without unbounded
stdout or loop history growth. Keep `--scan-limit` large enough for the current
ready-task backlog; if the scan is exhausted before matching tasks appear, the
drain will correctly do no work.

Generated task/event route workflow specs are lifecycle-managed. After a
generated one-shot route workflow run reaches `succeeded`, `failed`,
`timed_out`, or `cancelled`, OpenLoops archives the generated workflow spec while
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
task, `@hasna/events` delivers `task.created`, OpenLoops records the invocation
and admission item, OpenLoops creates a worker/verifier workflow when admitted,
and the workflow updates todos with evidence. Use account pools so worker and
verifier steps do not burn the same profile; OpenLoops picks deterministically
and uses a different verifier profile when the pool has at least two entries.
Use `--dry-run` to inspect the rendered invocation, work item, workflow, and
loop input without storing anything, including the worktree path and branch for
git-backed tasks.

Generated worker/verifier workflows fail closed when `sandbox=danger-full-access`
is requested without `manualBreakGlass=true`. Use `workspace-write` for
unattended task/event routes. Full access is an explicit manual emergency path,
not a default automation mode.

## Transcript-Driven Loops

OpenLoops can turn long-form media or meeting transcripts into recurring workflow work when paired with `iapp-transcriber`. The template at `docs/workflows/transcript-feedback-to-loops.json` transcribes an authorized media URL, asks an agent to extract recurring loop candidates, authors workflow specs, and validates generated workflows before scheduling. Copy it into the target repo, replace `/path/to/repo` with that repo's absolute path, and provide `TRANSCRIBER_SOURCE_URL` through the runner environment or a private, uncommitted workflow copy before storing or scheduling it. Do not commit private or signed media URLs.

```bash
loops workflows validate /path/to/repo/.openloops/transcript-feedback-to-loops.json --preflight
loops workflows create /path/to/repo/.openloops/transcript-feedback-to-loops.json
loops workflows run transcript-feedback-to-loops --show-output
```

See `docs/TRANSCRIPT_LOOP_PATTERNS.md` for transcript-to-loop guardrails and example schedules for review, maintenance, CI optimization, feedback triage, and knowledge-capture loops.

## Knowledge Feedback

OpenLoops can close the loop between failed automation and future agent runs by
using the Knowledge CLI as the durable store. Enable it per loop with
`--knowledge-feedback`, or set `knowledgeFeedback` on a command, agent, or
workflow target in JSON. Existing loops are unchanged unless feedback is
configured or `LOOPS_KNOWLEDGE_FEEDBACK=1` is set in the runner environment.

```bash
loops create command repo-health \
  --every 30m \
  --cmd "bun test" \
  --cwd /path/to/repo \
  --knowledge-feedback \
  --knowledge-store /path/to/knowledge-store
```

When enabled, terminal non-successful loop outcomes are summarized into a
deduped `knowledge upsert` record keyed by the run failure fingerprint. The
first event set covers failed, timed-out, and abandoned loop runs finalized by
the shared scheduler path. The shared classifier also recognizes skipped
circuit-breaker rows for future skipped-row emission points. Records include
bounded redacted error/stdout/stderr evidence, failure classification, loop/run
ids, target metadata, and workflow step summaries when the failed loop ran a
workflow.

Before an agent target starts, OpenLoops runs a bounded
`knowledge context pack` query using the loop/workflow/step metadata, routing
task/event metadata, cwd, and provider. Matching records are appended to the
agent prompt under a read-only `Relevant durable knowledge` section. This is
context data, not executable instructions.

Useful options:

```text
--knowledge-store <path>       pass --store to the Knowledge CLI
--knowledge-scope <scope>      local, global, or project (default local)
--knowledge-command <command>  executable name/path (default knowledge)
--knowledge-max-items <n>      context-pack item budget
--knowledge-max-tokens <n>     context-pack token budget
--knowledge-timeout <duration> Knowledge CLI timeout
```

The JSON shape is:

```json
{
  "type": "agent",
  "provider": "claude",
  "prompt": "Review the latest failure and propose the smallest fix.",
  "knowledgeFeedback": {
    "enabled": true,
    "store": "/path/to/knowledge-store",
    "scope": "local",
    "maxItems": 3,
    "maxTokens": 1600
  }
}
```

Knowledge feedback never writes ad hoc home-level Markdown. Durable lessons go
through `knowledge upsert`; prompt context is read with `knowledge context
pack`. Missing or failing Knowledge CLI calls are logged and do not crash run
finalization. Set `required: true` only when an agent should fail closed if it
cannot read the configured knowledge context before starting.

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
loops expectations <loop-id-or-name> --json
```

The JSON contains the expectation result, bounded error/stdout/stderr evidence,
a stable failure fingerprint, route metadata, and recommended task fields.
OpenLoops does not mutate Todos from `health` or `expectations`. To turn failed
expectations into deduped tasks, use the explicit routing command:

```bash
loops health route-tasks \
  --project ~/.hasna/loops \
  --task-list loop-error-self-heal \
  --max-actions 5
```

Use `--dry-run --json` first when testing a new automation path. Routed tasks
include the stable failure fingerprint, classification, loop id/name, and
`no_tmux_dispatch=true` metadata.

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

OpenLoops includes deterministic hygiene checks for replacing local maintenance
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
- Codewith uses durable `codewith --ask-for-approval never agent start` background-agent runs by default, then polls `codewith agent read` until the run is terminal. While the step is running, OpenLoops records bounded agent id/status updates as `step_progress` workflow events and as the running step's compact stdout; on terminal completion it records compact status/event evidence. Remote Codewith agent steps fail closed until remote durable readback is implemented, so workflows do not advance immediately after enqueue. OpenLoops rejects Codewith `extraArgs` that try to force `exec`, `--ephemeral`, or other non-durable exec-only flags for task-lifecycle, planner, worker, verifier, reviewer, release, or other long-running agentic work.
- AI Copilot and OpenCode use `run --format json --pure`. OpenCode requires an explicit provider/model id because ambient OpenCode config is machine-specific.
- Cursor is CLI-first for now via the standalone `agent -p` binary. OpenLoops no longer falls back to `cursor agent`; install the standalone Cursor Agent CLI so preflight and scheduled runs use the same executable.
- Codex uses `codex --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories where supported.
- Agent prompts are sent through child stdin instead of argv where the provider supports stdin. Codewith durable background agents currently accept prompts as native `agent start` arguments, so OpenLoops stores only bounded status/event evidence and omits raw Codewith prompt text and raw event payloads from workflow stdout.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` before `agent start/read/logs`; they do not call OpenAccounts.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
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

For production loops that can mutate repos, prefer the built-in
`worktreeMode=auto`/`required` path and explicit prompts that name allowed write
scope. Use `main` or `off` only for operations that intentionally need the
original checkout.
