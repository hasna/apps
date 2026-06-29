# OpenLoops

OpenLoops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `cursor agent` or `agent`
- `codewith exec`
- `aicopilot run`
- `opencode run`
- `codex exec`

## Install

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
`loops create workflow`, `loops workflows create`, and event-router commands such
as `loops events handle todos-task` and `loops events handle generic`. It checks
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
  --var authProfilePool=account004,account005,account006 \
  --var sandbox=workspace-write \
  --var todosProjectPath=$HOME/.hasna/loops \
  --var addDirs=$HOME/.hasna/todos,$HOME/.hasna/loops
loops templates create-workflow todos-task-worker-verifier \
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
  --var authProfilePool=account004,account005 \
  --var sandbox=workspace-write
loops templates render pr-review \
  --var prUrl=https://github.com/hasna/loops/pull/123 \
  --var projectPath=/path/to/repo
loops templates render deterministic-check-create-task \
  --var projectPath=/path/to/repo \
  --var checkCommand='your deterministic check and todos upsert command'
```

Repo-mutating task/event routes should set `worktreeMode=required` so the
workflow fails fast instead of falling back to the main checkout. When
`projectPath` is an existing git repository, OpenLoops inserts a
`prepare-worktree` command step before the worker and runs the worker/verifier
from a deterministic worktree under `~/.hasna/loops/worktrees/<repo>/<run>`.
The generated agent target includes worktree metadata (`mode`, `cwd`, `path`,
`branch`, `originalCwd`) so dry-runs and workflow inspection expose the exact
checkout.

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

For event-driven task automation, `loops events handle todos-task` reads a
Hasna event envelope from stdin or `HASNA_EVENT_JSON`, records a
`WorkflowInvocation`, upserts an admission work item, and admits that work item
into a deduped one-shot workflow loop when route capacity allows:

```bash
cat task-created-event.json | loops events handle todos-task \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
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

Use route throttles to avoid stampeding agents when a producer creates many
tasks at once:

```bash
cat task-created-event.json | loops events handle todos-task \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
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
loops events drain todos-task \
  --todos-project "$HOME/.hasna/loops" \
  --task-list repoops-pr-queue \
  --tags auto:route \
  --project-path-prefix "$HOME/workspace/hasna/opensource" \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
  --add-dir "$HOME/.hasna/todos,$HOME/.hasna/loops" \
  --project-group oss \
  --max-dispatch 2 \
  --scan-limit 500 \
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

For other Hasna apps that expose `@hasna/events` webhooks, use the generic
handler:

```bash
cat event.json | loops events handle generic \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
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
`context_length`, `schema_response_format`, `node_init`, `timeout`, `sigsegv`,
`skipped_previous_active`, and `unknown`.

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
only renames when `--apply` is present. Apply mode writes a SQLite backup under
`<LOOPS_DATA_DIR>/backups` before changing loop names. `hygiene duplicates`
groups loops with the same normalized name, cwd, and schedule. `hygiene scripts`
inventories loops whose command still references `~/.hasna/loops/scripts`; use
it as a migration gate before deleting local scripts. `hygiene route-tasks`
upserts deduped Todos tasks for hygiene findings with stable fingerprints and
`no_tmux_dispatch=true` metadata; use `--dry-run --json` before enabling it as a
production loop. Route commands store a small cursor in
`<LOOPS_DATA_DIR>/route-cursors.json` so bounded `--max-actions` runs advance
through all findings over repeated scheduled runs instead of reprocessing only
the first batch.

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
- Codewith uses `codewith --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories.
- AI Copilot and OpenCode use `run --format json --pure`.
- Cursor is CLI-first for now via standalone `agent -p` when available, with `cursor agent -p` as a compatibility fallback; treat output as less stable until a stronger public SDK contract is selected.
- Codex uses `codex exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories where supported.
- Agent prompts are sent through child stdin instead of argv so prompt bodies do not appear in process listings.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` before `exec`; they do not call OpenAccounts.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
- `--variant` is provider-specific reasoning/model effort. Claude maps it to `--effort`, Codewith/Codex map it to `model_reasoning_effort`, and OpenCode/AICopilot pass `--variant`.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For production loops that can mutate repos, prefer the built-in
`worktreeMode=auto`/`required` path and explicit prompts that name allowed write
scope. Use `main` or `off` only for operations that intentionally need the
original checkout.
