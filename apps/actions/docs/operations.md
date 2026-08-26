# Storage and Executors

## Local Store

`ActionsClient`, the CLI, and `actions-mcp` default to `SQLiteActionsStore`.
The default database is:

```text
~/.hasna/actions/actions.db
```

The data home is resolved through `@hasna/paths`. Directory precedence is an
explicit constructor or CLI `--dir` override, `HASNA_ACTIONS_DIR`,
`HASNA_ACTIONS_HOME`, then the XDG data home once adopted (the store is migrated
to `~/.local/share/hasna/actions` on Linux / `~/Library/Application
Support/Hasna/actions` on macOS, or the operator sets `HASNA_DATA_HOME`), and
finally the legacy `~/.hasna/actions` default. Until the XDG home is adopted, the
legacy default stays the effective data home so an existing store never becomes
invisible on upgrade. SQLite initialization creates the data directory with mode
`0700` and the database file with mode `0600` on a best-effort basis.
Directories or volumes that reject `chmod` remain usable.

On first open, the SQLite store imports any legacy JSON records from:

```text
~/.hasna/actions/manifests.json
~/.hasna/actions/runs.json
~/.hasna/actions/audit-events.json
```

The import runs in one immediate transaction with `INSERT OR IGNORE`, so
existing database rows are not overwritten. Legacy files are left in place.
Unreadable legacy files are reported to standard error and skipped for that
open; the migration remains incomplete so repaired files can be imported later.

Saving a manifest replaces the existing record with the same id; versions are
not stored side by side. Runs and events are newest-first when listed. SQLite
uses a five-second busy timeout for concurrent local writers.

`JsonActionsStore` remains available for explicit compatibility use. It keeps
the three JSON arrays above, creates each file with mode `0600` where the
platform permits, and writes with a temporary file plus rename. It reads and
rewrites complete arrays, so it is intended for local, small-scale use rather
than concurrent distributed writers.

`getActionsStatus` initializes the default SQLite store and reports the active
directory, environment source, database path/existence, and table record counts.

## Local-Shell Input

`createLocalShellAction` selects the first `local-shell` binding. Previewing does
not spawn the process; it returns the command, arguments, cwd, I/O modes, and a
high-risk warning when applicable.

Input modes are:

- `stdin-json` (default): write one JSON line to standard input.
- `env-json`: set `OPEN_ACTIONS_INPUT` and close standard input.
- `stdin-and-env-json`: use both channels.
- `none`: use neither input channel.

Every process receives `OPEN_ACTIONS_RUN_ID`, `OPEN_ACTIONS_ACTION_ID`,
`OPEN_ACTIONS_ACTION_VERSION`, and `OPEN_ACTIONS_DRY_RUN`.

## Process Environment

By default, only `PATH`, `HOME`, `TMPDIR`, `TEMP`, and `TMP` are copied from the
parent process. Binding `env` values are then added, followed by the package's
`OPEN_ACTIONS_*` values. Set `inheritEnv: true` only when the child intentionally
needs the complete parent environment.

`cwd` and `timeoutMs` are passed to the child process. On timeout the executor
sends `SIGTERM` and waits for the child to close; it does not escalate to
`SIGKILL`.

## Local-Shell Output

- `json` (default) parses trimmed stdout as JSON; empty stdout becomes `{}`.
- `text` returns stdout unchanged.
- `shell-result` returns status, command, arguments, cwd, exit code or signal,
  stdout, and stderr.

A nonzero exit, signal, or spawn error throws `ShellActionError`, whose `result`
contains the captured process details. JSON parse errors also fail the action.
Stdout and stderr are buffered in memory without a package-level size limit.
