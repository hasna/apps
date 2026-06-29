# OpenLoops

OpenLoops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `agent` (Cursor Agent CLI)
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

For `codewith` and `aicopilot` account isolation, register matching OpenAccounts tools first if they are not built in on the machine:

```bash
accounts tools add codewith --label "Codewith" --env-var CODEWITH_HOME --bin codewith
accounts tools add aicopilot --label "AI Copilot" --env-var AICOPILOT_CONFIG_DIR --bin aicopilot
```

## Goals

Add `--goal` to wrap a command, agent, or workflow loop in an AI-SDK orchestration layer. OpenLoops asks the configured model to create a flat DAG plan, executes ready nodes by calling the underlying target, then runs an adversarial achievement audit before marking the goal complete.

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

Goal planning and validation use the Vercel AI SDK with `@openrouter/ai-sdk-provider`. Set `OPENROUTER_API_KEY`; optionally set `LOOPS_GOAL_BASE_URL` to point at a local gateway compatible with OpenRouter. Goal context is passed to wrapped commands and agents as `LOOPS_GOAL_ID`, `LOOPS_GOAL_OBJECTIVE`, and `LOOPS_GOAL_NODE_KEY`.

Inspect configured and runtime goal state:

```bash
loops goal show <loop-or-goal-id>
loops goal status <goal-run-id-or-loop-run-id>
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
  --var sandbox=workspace-write \
  --var worktreeMode=required
loops templates render pr-review \
  --var prUrl=https://github.com/hasna/loops/pull/123 \
  --var projectPath=/path/to/repo
loops templates render deterministic-check-create-task \
  --var projectPath=/path/to/repo \
  --var checkCommand='your deterministic check and todos upsert command'
```

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
loops routes invocations
```

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
console.log(binding.eventHandoff.handlerCommand); // "loops events handle generic"
```

The claim-queue handoff uses the OpenAutomations CLI or SDK:

```bash
automations queue claim --runner open-loops:<worker-id>
automations queue complete <action-id> --runner open-loops:<worker-id>
automations queue fail <action-id> --runner open-loops:<worker-id> --code <code> --message <message>
```

For explicit event workflow routing, OpenAutomations can export the normalized
event envelope and OpenLoops can consume it through the existing generic event
handler:

```bash
automations --json webhooks event <route> --body-json '<json>' \
  | loops --json events handle generic
```

This is not automation materialization in OpenLoops. It is an explicit
event-envelope workflow handoff: OpenAutomations owns deterministic automation
specs, webhook normalization, queue state, approvals, DLQ, and replay; OpenLoops
owns agent workflow invocation after the operator routes the envelope to
`loops events handle generic`.

Do not store automation specs in OpenLoops, infer automation triggers from event
transport alone, or replace the OpenAutomations queue with loop/workflow rows.
When a loop or workflow is used for execution, keep `HASNA_AUTOMATIONS_DIR`
pointing at the owning OpenAutomations data root and preserve the runner id in
completion/failure calls so OpenAutomations can enforce action leases.

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

## Health And Hygiene

```bash
loops health --json
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
renames only with `--apply`. Apply mode writes a SQLite backup under
`<LOOPS_DATA_DIR>/backups` before changing loop names. `hygiene duplicates`
groups loops with the same normalized name, cwd, and schedule. `hygiene scripts`
inventories loops whose command still references `~/.hasna/loops/scripts`.
`hygiene route-tasks` upserts deduped Todos tasks for hygiene findings with
stable fingerprints and `no_tmux_dispatch=true` metadata. Route commands use a
package-managed cursor under `<LOOPS_DATA_DIR>/route-cursors.json` so bounded
`--max-actions` runs advance through all findings over repeated scheduled runs
instead of reprocessing only the first batch.

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
- Cursor is CLI-first for now via the standalone `agent -p` binary. OpenLoops no longer falls back to `cursor agent`; install the standalone Cursor Agent CLI so preflight and scheduled runs use the same executable.
- Codex uses `codex --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`, with `--add-dir` for explicit extra writable directories where supported.
- Agent prompts are sent through child stdin instead of argv so prompt bodies do not appear in process listings.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` before `exec`; they do not call OpenAccounts.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
- `--variant` is provider-specific reasoning/model effort. Claude maps it to `--effort`, Codewith/Codex map it to `model_reasoning_effort`, and OpenCode/AICopilot pass `--variant`.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For production loops that can mutate repos, prefer disposable worktrees and explicit prompts that name allowed write scope.
