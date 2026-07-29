# CLI reference

The `actions` binary reads and writes the local JSON store. The global syntax is:

```text
actions [options] [command]

Options:
  --dir <path>  Override local actions data directory
  -V, --version Output the version number
  -h, --help    Display help for command
```

Put `--dir` before the command in scripts. If it is omitted, storage follows the
environment-variable precedence described in [Storage](storage.md).

## Commands

| Command | Purpose |
| --- | --- |
| `status` | Show the data directory and stored-record counts. |
| `project-panel` | Emit a bounded `hasna.project_panel.v1` project summary. |
| `manifests validate` | Apply the package's structural manifest checks to a JSON file. |
| `manifests list` | List stored manifests. |
| `manifests show` | Show one stored manifest. |
| `manifests inspect` | Show one manifest with expanded human detail. |
| `run` | Register a local-shell manifest, plan it, preview it, and optionally execute it. |
| `runs list` | List stored runs. |
| `runs show` | Show one run. |
| `runs inspect` | Show one run with expanded human detail. |
| `approve` | Add an approval to a stored run. |
| `deny` | Add a denial to a stored run. |
| `execute` | Register a local-shell manifest and execute an approved stored run. |

Every command supports `-h, --help`. Commands with `-j, --json` print the stored
object or command-specific JSON instead of the compact human view.

## Storage status

```text
actions status [--verbose] [--json]
```

- `--verbose` adds the three storage file paths, existence flags, and record
  counts to human output.
- `--json` emits the complete `ActionsStatus` object. It includes the active
  storage environment variable, if any.

Running `status` initializes the data directory and its three JSON files.

## Project panel

```text
actions project-panel --project <slug> [--limit <n>] [--contract] [--json]
```

- `--project` is required.
- `--limit` is a positive integer and defaults to 20. Manifests are placed in
  `items` first; recent runs fill the remaining item slots.
- `--contract` is a compatibility flag. The command always validates its result
  against `hasna.project_panel.v1`, so this flag does not currently change the
  emitted value.
- Human output contains only the project slug and manifest/run counts. Use
  `--json` for the complete panel contract.

A manifest belongs to a project when `metadata.projectId`, `metadata.project`,
or `metadata.project_id` equals the slug. Without explicit project metadata, it
must have project scope and list the slug in `resource.identifiers`. A run with
explicit project metadata uses the same keys; otherwise it belongs when its
action manifest belongs to the project.

See [Project dashboards](project-dashboards.md) for the panel shape and the
separate view-safe action capability projection.

## Manifests

### Validate

```text
actions manifests validate <file> [--verbose] [--json]
```

The file must contain JSON. This command checks non-empty `id`, `name`,
`version`, and `description`, requires truthy input and output schemas, and
requires at least one executor binding. It does not store the manifest, run JSON
Schema validation, enforce actor/scope policy, or scan for secrets. See
[Manifest validation](manifests.md#current-runtime-validation).

Human output is `valid <id>@<version>`. `--verbose` prints the expanded bounded
manifest view. `--json` emits `{ "ok": true, "manifest": ... }` and takes
precedence over the human detail mode.

### List

```text
actions manifests list [--limit <n>] [--cursor <offset>] [--verbose] [--json]
```

- Human output defaults to 20 rows and prints the next cursor when more records
  exist. `--verbose` allows longer descriptions in the table.
- `--limit` must be positive and is capped at 100 by pagination.
- `--cursor` is a zero-based offset. Missing, invalid, and negative cursors are
  treated as zero.
- `--json` returns the full stored manifest array. With neither pagination flag
  it returns every manifest; when `--limit` or `--cursor` is supplied it returns
  only that page, still as an array rather than a page envelope.

### Show and inspect

```text
actions manifests show <id> [--verbose] [--json]
actions manifests inspect <id> [--json]
```

`<id>` may be an exact manifest id or a prefix that matches exactly one stored
manifest. `show` uses bounded compact human output; `--verbose` adds actor,
idempotency, dry-run, guardrail, rollback, and truncated schema fields.
`inspect` selects that expanded human view directly. `--json` returns the full
stored manifest for either command.

## Run a local-shell manifest

```text
actions run <manifest> \
  [--input <json>] [--input-file <path>] \
  [--idempotency-key <key>] [--actor <id>] \
  [--dry-run] [--approve] [--verbose] [--json]
```

The command reads and structurally validates the manifest, requires a
`local-shell` executor binding, registers it in the current process, and stores
the manifest. Input defaults to `{}`. If both input flags are present,
`--input-file` wins. The actor defaults to `{ id: "cli", type: "human" }`.

The command always previews before it can execute. Unlike SDK and MCP calls,
the CLI passes an explicit `dryRun` boolean: it is `true` with `--dry-run` and
`false` otherwise. Therefore omitting `--dry-run` overrides a manifest whose
`dryRun.default` is `true` and requests execution after preview.

`--approve` adds one approval from the CLI actor before the execution attempt.
If that does not satisfy all approval requirements, the stored run remains
`awaiting_approval`. Without `--approve`, a run that requires approval is also
left `awaiting_approval` for the separate approval and execution commands.

Default human output is one status/id/summary line. `--verbose` prints bounded
run details, while `--json` returns the complete stored run.

## Inspect runs

### List

```text
actions runs list \
  [--action <id>] [--status <status>] \
  [--limit <n>] [--cursor <offset>] [--verbose] [--json]
```

Runs are sorted newest first. `--action` and `--status` are exact string filters;
the CLI does not validate the status string. Pagination and JSON behavior match
`manifests list`: human output defaults to 20, pagination caps at 100, and JSON
returns all full records unless either pagination flag is supplied.

### Show and inspect

```text
actions runs show <id> [--verbose] [--json]
actions runs inspect <id> [--json]
```

`<id>` may be an exact run id or a prefix that matches exactly one stored run.
Compact human output omits input, output, plan, and events. The verbose view
includes truncated input/output, up to ten plan steps, and the five most recent
embedded events. JSON returns the full stored run.

## Approve, deny, and execute

```text
actions approve <run-id> [--actor <id>] [--reason <text>] [--verbose] [--json]
actions deny <run-id> [--actor <id>] [--reason <text>] [--verbose] [--json]
actions execute <run-id> <manifest> [--verbose] [--json]
```

These commands require the exact stored run id; unlike the `show` commands,
they do not resolve prefixes. Approval and denial actors default to the human
CLI actor. `approve` records an approved decision and `deny` records a denied
decision.

`execute` reads and registers the supplied local-shell manifest in the current
process, then executes the stored run. The manifest id must match the run's
action id. A denied run is returned unchanged. A dry-run remains a preview. A
run without enough approvals becomes or remains `awaiting_approval`; otherwise
the local command runs.

## Output and error behavior

Human list and detail views intentionally truncate long values. JSON output is
the fidelity-preserving form except when list pagination was explicitly
requested. Errors are written to stderr by the installed binary and exit with
status 1; successful commands exit with status 0.
