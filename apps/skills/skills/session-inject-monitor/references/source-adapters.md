# Source adapters — reader matrix

Source readers are the DETECTION half. Each reader is a self-contained gate: given
a cursor file (via `SIM_CURSOR_FILE`), it fetches the source, computes the newest
cursor token, compares, and when new: atomically stores the new cursor and prints
one `NEW <summary>` line per item to stdout. It prints NOTHING when nothing is new
and when the cursor file is absent (baseline). Exit 0 = ran cleanly; exit 2 = error
(a failing reader must never be read as "no new content").

Common reader env: `SIM_CURSOR_FILE` (required), `SIM_BASELINE` (0/1), and
`SIM_NEWLINE_CAP` (default 200 chars per NEW line). All readers are
`set -euo pipefail`, do their JSON reads with capture-path discipline (redirect to
a file, parse from the file — large JSON is never piped), work in a scratch dir
that is removed on exit, and never print full payloads or credentials.

## conversations — [measured shape]

`scripts/src-conversations.sh <channel>`

- Invokes `conversations digest <channel> --since <window> --json` and follows
  `has_more`/`next_cursor` to exhaustion (bounded at 50 pages).
- Cursor = max message `id` (integer), compared numerically.
- Per NEW message emits: `NEW [<from>] <snippet>` with the snippet truncated at
  `SIM_NEWLINE_CAP`. Digest snippets are ≤ 320 bytes by contract and reported with
  `truncated`; the full body requires `conversations show <id>` (a second call) and
  is deliberately never injected — a snippet is enough to wake, not enough to act.
- Flags and field names are from the fleet-measured digest surface (id, from,
  snippet, has_more, next_cursor).

## emails — [unverified shape]

`scripts/src-emails.sh`

- Invokes `emails inbox read --json` (override `SIM_EMAILS_READ_ARGS`); the exact
  flags were NOT measurable on this box on 2026-08-19 because vault auth is absent
  here — run the command by hand once before relying on the adapter.
- Cursor = max numeric id (`.id`/`.message_id`) when numeric, else max ISO
  `received_at`/`created_at`/`date` (lexicographic compare is fine for ISO).
- Emits `NEW <subject>` per new message (oldest first), capped.

## todos — [measured shape]

`scripts/src-todos.sh`

- Invokes `todos list --inbox --format json --sort updated --limit 500` by default
  (`--inbox` = work assigned to this identity by another agent — the config for a
  monitor); override `SIM_TODOS_ARGS` for `--assigned <name>`, `--status`,
  `--project-name`, or a task-list ref.
- Cursor = max `updated_at` (fallback `created_at`); ISO lexicographic compare.
- Emits `NEW [<status>] <title>` per changed task. Optional `SIM_TODOS_MIN_AGE_S`
  squelches items updated inside the last N seconds — a monitor's own heartbeats or
  status churn are not signals.
- Flags are verified in `todos list --help` (this box).

## knowledge — [measured shape]

`scripts/src-knowledge.sh`

- Invokes `knowledge list --limit 200 --sort created --desc --json` by default
  (override `SIM_KNOWLEDGE_ARGS`).
- The knowledge CLI has no `--sort updated`; updates are detected from
  `updated_at` in the rows with a client-side sort (documented behavior).
- Cursor = max `updated_at` (fallback `created_at`); ISO lexicographic compare.
- Emits `NEW <title>  (tags: <tags>)` per new/updated item, capped.

## command — [measured shape]

`scripts/src-command.sh -- <cmd...>` or `SIM_COMMAND="<cmd>"`

- Runs the command with a `timeout` (default 120s `SIM_COMMAND_TIMEOUT`), capturing
  stdout and stderr to separate files.
- Cursor = sha256 of stdout. New = hash differs (including a flip to empty — real
  state, not silence).
- Emits `NEW <hash> (<n> lines) <first line>`; the full stdout is never printed.

## Gate orchestration

`scripts/hasna-session-inject-gate.sh --manifest <yaml>` maps each manifest source
onto the matching reader (kind → script), exports the manifest `args` as the
reader's env, runs each reader with a per-source timeout under a flock (one firing
at a time), logs one line per source per firing to the monitor log, and only if at
least one source produced NEW content renders the prompt and calls the target
injector. A failing reader is logged, skipped, and never triggers an injection.

Modes: `--emit-only` (print the NEW summaries, no injection — the verification
step), `--baseline` (store cursors, inject nothing), `--list-sources` (print the
resolved source set from the manifest).