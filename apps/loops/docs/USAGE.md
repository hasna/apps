# OpenLoops Usage

OpenLoops is a local CLI and daemon for persistent loops: scheduled or recurring work that survives process restarts and records every run.

It supports deterministic command loops today and guarded CLI adapters for headless coding agents:

- `claude`
- `cursor-agent`
- `codewith exec`
- `aicopilot run`
- `opencode run`

## Install

From npm:

```bash
npm install -g @hasna/loops
loops --version
```

Update:

```bash
npm update -g @hasna/loops
```

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

Run a Codewith loop every 15 minutes:

```bash
loops create agent supply-chain-watch \
  --provider codewith \
  --every 15m \
  --cwd /path/to/repo \
  --prompt "Check for suspicious dependency or supply-chain changes. Report only concrete findings."
```

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

Use `--json` for machine-readable output. Prompt bodies and run stdout/stderr are redacted by default in status output.

## Daemon

```bash
loops daemon start
loops daemon status
loops daemon logs
loops daemon stop
```

Run in the foreground for supervised environments:

```bash
loops daemon run
```

Install startup integration:

```bash
loops daemon install
```

On Linux this writes a user systemd service. On macOS it writes a LaunchAgent plist. The command prints the exact enable/load commands to run.

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
- Running rows have leases. If a daemon dies, a later daemon marks expired running rows as `abandoned`.

## Agent Adapter Notes

The adapters intentionally use provider command surfaces instead of pretending every agent has one SDK:

- Claude uses `claude -p --output-format json` and safe-mode/local setting sources by default.
- Codewith uses `codewith exec --json --ephemeral --ask-for-approval never`.
- AI Copilot and OpenCode use `run --format json --pure`.
- Cursor is CLI-first for now via `cursor-agent -p`; treat output as less stable until a stronger public SDK contract is selected.

For production loops that can mutate repos, prefer disposable worktrees and explicit prompts that name allowed write scope.
