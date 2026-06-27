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
  --sandbox danger-full-access \
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

Run a Codewith loop with a Codewith-native auth profile:

```bash
loops create agent supply-chain-watch \
  --provider codewith \
  --auth-profile account001 \
  --every 15m \
  --cwd /path/to/repo \
  --sandbox danger-full-access \
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

```bash
loops templates list
loops templates render todos-task-worker-verifier \
  --var taskId=<task-id> \
  --var taskTitle="Fix parser" \
  --var projectPath=/path/to/repo \
  --var provider=codewith \
  --var authProfilePool=account004,account005,account006 \
  --var sandbox=danger-full-access
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
  --var sandbox=danger-full-access
```

For event-driven task automation, `loops events handle todos-task` reads a
Hasna event envelope from stdin or `HASNA_EVENT_JSON`, renders the template, and
schedules a deduped one-shot workflow loop:

```bash
cat task-created-event.json | loops events handle todos-task \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
  --permission-mode bypass \
  --sandbox danger-full-access
```

Task routing is explicit opt-in. The handler skips the event without creating a
workflow unless the event data or metadata has `route_enabled=true`,
`automation.allowed=true`, or a task tag containing `auto:route`. It also skips
blocked, completed/done, cancelled/canceled, failed, archived, manual,
approval-required, or `no-auto` tasks. This guard exists even when the upstream
`@hasna/events` webhook filter is misconfigured, so task existence alone is not
permission to execute agent work.

For other Hasna apps that expose `@hasna/events` webhooks, use the generic
handler:

```bash
cat event.json | loops events handle generic \
  --provider codewith \
  --auth-profile-pool account004,account005,account006 \
  --permission-mode bypass \
  --sandbox danger-full-access \
  --project-path /path/to/repo
```

This is the intended deterministic-to-agentic path: a producer creates a todos
task, `@hasna/events` delivers `task.created`, OpenLoops creates a worker and a
verifier workflow, and the workflow updates todos with evidence. Use account
pools so worker and verifier steps do not burn the same profile; OpenLoops picks
deterministically and uses a different verifier profile when the pool has at
least two entries. Use `--dry-run` to inspect the rendered workflow and loop
input without storing anything.

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
```

`hygiene names` reports canonical `machine-*` or `repo-<name>-*` loop names and
only renames when `--apply` is present. `hygiene duplicates` groups loops with
the same normalized name, cwd, and schedule. `hygiene scripts` inventories loops
whose command still references `~/.hasna/loops/scripts`; use it as a migration
gate before deleting local scripts.

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
- Codewith uses `codewith --ask-for-approval never exec --json --ephemeral --skip-git-repo-check`.
- AI Copilot and OpenCode use `run --format json --pure`.
- Cursor is CLI-first for now via `cursor agent -p`, with `agent -p` as the fallback launcher on machines that expose the standalone Cursor Agent binary; treat output as less stable until a stronger public SDK contract is selected.
- Codex uses `codex exec --json --ephemeral --ask-for-approval never`.
- Agent prompts are sent through child stdin instead of argv so prompt bodies do not appear in process listings.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` before `exec`; they do not call OpenAccounts.
- `--sandbox` maps to provider-native sandbox flags. Codewith/Codex accept `read-only`, `workspace-write`, or `danger-full-access`; Cursor accepts `enabled` or `disabled`.
- `--permission-mode` maps `plan`, `auto`, and `bypass` where the provider supports it. Claude uses native permission modes, Cursor maps bypass to `--force`, and OpenCode/AICopilot map bypass to `--dangerously-skip-permissions`.
- `--variant` is provider-specific reasoning/model effort. Claude maps it to `--effort`, Codewith/Codex map it to `model_reasoning_effort`, and OpenCode/AICopilot pass `--variant`.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For production loops that can mutate repos, prefer disposable worktrees and explicit prompts that name allowed write scope.
