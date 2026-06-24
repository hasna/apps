# OpenLoops

OpenLoops is a local CLI and daemon for persistent loops and workflows: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops, JSON-defined workflows, and guarded CLI adapters for headless coding agents:

- `claude`
- `cursor-agent`
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
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

Run a Codewith loop with a Codewith-native auth profile:

```bash
loops create agent supply-chain-watch \
  --provider codewith \
  --auth-profile account001 \
  --every 15m \
  --cwd /path/to/repo \
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

For `codewith` and `aicopilot` account isolation, register matching OpenAccounts tools first if they are not built in on the machine:

```bash
accounts tools add codewith --label "Codewith" --env-var CODEWITH_HOME --bin codewith
accounts tools add aicopilot --label "AI Copilot" --env-var AICOPILOT_CONFIG_DIR --bin aicopilot
```

## Labels

Add `--label <label>` when creating command, agent, or workflow loops. The flag is repeatable:

```bash
loops create command repo-status --every 1m --cmd "git status --short" --label browserplan --label maintenance
loops list --label browserplan
loops runs --label browserplan
```

Labels are normalized to lowercase and must start with a letter or digit. Use only letters, digits, dots, dashes, and underscores. A loop can have up to 32 labels.

Manage labels after creation:

```bash
loops labels add repo-status urgent
loops labels remove repo-status maintenance
loops labels set repo-status browserplan nightly
loops labels clear repo-status
```

Repeated `--label` filters require all requested labels to be present. Run filtering uses the loop's current labels, not a historical label snapshot stored on each run.

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
loops remove <id-or-name>
loops run-now <id-or-name>
```

Use `--json` for machine-readable output. Prompt bodies and run stdout/stderr are redacted by default in status output. `loops run-now` exits non-zero when the recorded run fails or times out.

Human output is compact by default so agent terminals do not fill with full records:

```bash
loops list                 # first compact page, default 25 rows
loops list --limit 50
loops list --cursor 25     # next page when the previous command prints a cursor hint
loops show <id-or-name>    # compact detail
loops show <id-or-name> --verbose
loops runs --show-output --max-output-chars 8000
loops daemon status --verbose
loops-daemon status --json
```

Use `show`/`inspect` commands for one record at a time. Use `--verbose` for full redacted detail output and `--json` for stable machine-readable records. Output streams are redacted unless explicitly requested and are bounded in human output.
The standalone `loops-daemon` helper follows the same compact default output; add `--verbose` or `--json` for full lifecycle and install records.

`loops run-now` reports the manual run source:

- `source=ad_hoc`: the loop was not due yet, so OpenLoops created a one-off manual slot. This is a single immediate attempt and does not schedule retries or consume the future scheduled slot.
- `source=due_slot`: the persisted scheduled slot was already due, so the manual run claims that slot and advances or retries the loop using normal scheduler rules.
- `source=retry_slot`: the loop was waiting on a failed slot retry, so the manual run claims that retry slot and advances the loop using normal retry rules.

## MCP Server

OpenLoops ships a stdio MCP server for local agents and MCP clients:

```json
{
  "mcpServers": {
    "openloops": {
      "command": "loops-mcp",
      "args": []
    }
  }
}
```

When running from a source checkout, use:

```json
{
  "mcpServers": {
    "openloops": {
      "command": "bun",
      "args": ["run", "/path/to/open-loops/src/mcp/index.ts"]
    }
  }
}
```

The server exposes these tools:

- `openloops_create_loop`: create command, agent, or workflow loops with schedules, labels, policy, goals, and machine assignment.
- `openloops_list_loops`: list loops by status and labels.
- `openloops_get_loop`: read one loop with bounded recent runs.
- `openloops_run_now`: run a loop immediately using normal OpenLoops execution semantics.
- `openloops_pause_loop`, `openloops_resume_loop`, `openloops_stop_loop`, `openloops_delete_loop`: manage loop lifecycle.
- `openloops_update_labels`: set, add, remove, or clear loop labels.
- `openloops_list_runs`: inspect recent runs by loop, status, labels, and bounded output.
- `openloops_validate_workflow`: validate a workflow spec object and optionally preflight targets.
- `openloops_create_workflow`, `openloops_list_workflows`, `openloops_get_workflow`, `openloops_archive_workflow`: manage stored workflow specs.
- `openloops_run_workflow`, `openloops_list_workflow_runs`, `openloops_inspect_workflow_run`, `openloops_list_workflow_events`, `openloops_cancel_workflow_run`, `openloops_recover_workflow_run`: run, inspect, cancel, and recover workflow executions.
- `openloops_get_goal`, `openloops_get_goal_status`: read configured or runtime goal state.
- `openloops_list_machines`, `openloops_resolve_machine`: inspect OpenMachines assignments for loops.
- `openloops_tick`: run one scheduler tick, claiming and executing due loops.
- `openloops_daemon_status`: read daemon process, lease, loop, and run counts.
- `openloops_doctor`: run local health checks.

Tool responses include structured JSON plus a compact text JSON summary. List/read tools return compact records by default and accept `verbose` where full redacted records are useful. Run stdout/stderr and agent prompts are redacted by default; tools that expose output accept `showOutput` and cap text through `maxOutputChars` up to 32,000 characters. Inspect/get tools cap child collections by default and expose explicit limits such as `stepsLimit`, `eventsLimit`, and `nodesLimit`. MCP command loop creation uses the same typed command target boundary as the CLI and SDK. Connect the server only to trusted local clients because `openloops_run_now`, `openloops_run_workflow`, and `openloops_tick` can execute loops or workflows stored in OpenLoops.

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
- Cursor is CLI-first for now via `cursor-agent -p`; treat output as less stable until a stronger public SDK contract is selected.
- Codex uses `codex exec --json --ephemeral --ask-for-approval never`.
- Agent prompts are sent through child stdin instead of argv so prompt bodies do not appear in process listings.
- When `--account` or a step `account` is set, OpenLoops resolves `accounts env <profile> --tool <tool>` before spawning the target, strips inherited tool home/API-key variables, and applies the selected profile only to that process. Missing account profiles fail before the provider binary receives the prompt.
- `--auth-profile` and step `authProfile` are provider-native auth selectors. They currently apply to Codewith and are passed to Codewith as `--auth-profile <name>` before `exec`; they do not call OpenAccounts.
- Daemon and scheduled runs prepend common user executable directories such as `~/.local/bin` and `~/.bun/bin` before resolving provider CLIs.

For production loops that can mutate repos, prefer disposable worktrees and explicit prompts that name allowed write scope.
