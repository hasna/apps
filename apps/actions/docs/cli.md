# CLI Reference

The `actions` binary manages the local action store and runs `local-shell`
manifests. It is installed with `@hasna/actions`.

```bash
bun add @hasna/actions
actions --help
```

## Global Options

| Option | Behavior |
| --- | --- |
| `--dir <path>` | Use this data directory instead of `HASNA_ACTIONS_DIR`, `HASNA_ACTIONS_HOME`, the adopted XDG data home (via `@hasna/paths`), or `~/.hasna/actions`. |
| `-V, --version` | Print the package CLI version. |
| `-h, --help` | Print help for the current command. |

Place `--dir` before the subcommand, for example
`actions --dir /tmp/actions status`.

## Output and Pagination

Human-readable output is the default. Add `-j` or `--json` to commands that
support it to print JSON.

`manifests list` and `runs list` show 20 human-readable rows by default and
accept an offset `--cursor`. Their effective list limit is capped at 100. JSON
lists return all matching stored objects when neither `--limit` nor `--cursor`
is supplied; when either option is supplied, they return only that page as a
JSON array. JSON lists do not include a pagination envelope.

`show` accepts an exact id or a unique id prefix. An absent or ambiguous prefix
is an error. `inspect` is the expanded human view; it returns the same full
stored object as `show` when `--json` is used.

## Storage Status

```text
actions status [--verbose] [-j, --json]
```

Reports the active data directory and manifest, run, and audit-event counts.
`--verbose` adds the SQLite database path and the manifest, run, and audit-event
table counts to human output.

## Project Panel

```text
actions project-panel --project <slug> [--limit <n>] [--contract] [-j, --json]
```

Builds a `hasna.project_panel.v1` panel from project-matching manifests and
runs. The default item limit is 20; manifests consume the limit before recent
runs. A record matches when its metadata contains the requested project under
`projectId`, `project`, or `project_id`. A manifest can also match through a
`project` scope whose resource identifiers contain the slug, and runs for those
manifests are included.

The panel is schema-validated before output. `--contract` emits the validated
JSON contract even without `--json`. Without `--contract` or `--json`, the
command prints only the action and recent-run counts.

## Manifests

```text
actions manifests validate <file> [--verbose] [-j, --json]
actions manifests list [--limit <n>] [--cursor <offset>] [--verbose] [-j, --json]
actions manifests show <id> [--verbose] [-j, --json]
actions manifests inspect <id> [-j, --json]
```

- `validate` parses JSON and applies the package's manifest assertions without
  storing the manifest. Human output is `valid <id>@<version>` unless
  `--verbose` is set.
- `list` reads all stored manifests, then applies output pagination. In the
  current formatter, `--verbose` widens the bounded description column.
- `show` prints one compact manifest; `--verbose` adds bounded schemas and
  execution metadata.
- `inspect` is equivalent to the expanded human detail view.

## Plan and Run

```text
actions run <manifest> [--input <json> | --input-file <path>]
  [--idempotency-key <key>] [--actor <id>] [--actor-role <role...>]
  [--dry-run] [--approve] [--verbose] [-j, --json]
```

The command validates and registers the `local-shell` manifest in this process,
then plans and previews a run. `--input-file` takes precedence when both input
options are supplied; omitted input defaults to `{}`. The actor defaults to a
human actor with id `cli`; repeat `--actor-role` values are attached to that
actor for role-gated approvals.

- `--dry-run` stops after preview with status `previewed`.
- `--approve` records one approval before execution. Use `--actor-role` when the
  manifest requires an approval role. Additional approval counts or unsatisfied
  role requirements can still leave the run `awaiting_approval`.
- Without `--dry-run`, the command attempts execution after preview. It executes
  only when approval requirements are satisfied; otherwise it persists an
  `awaiting_approval` run.
- `--idempotency-key` is mandatory when the manifest requires one. Reusing a key
  returns an existing non-failed, non-denied, non-cancelled run.

`run` passes `dryRun: false` unless `--dry-run` is present, so the CLI does not
inherit the manifest's `dryRun.default` value.

## Runs

```text
actions runs list [--action <id>] [--status <status>] [--limit <n>]
  [--cursor <offset>] [--verbose] [-j, --json]
actions runs show <id> [--verbose] [-j, --json]
actions runs inspect <id> [-j, --json]
```

Runs are sorted newest first. `--action` and `--status` are exact-match filters.
The list and detail output rules match the manifest commands. Verbose run detail
includes bounded input, output, plan, guardrail, evidence, and event previews.

## Approve, Deny, and Execute

```text
actions approve <run-id> [--actor <id>] [--actor-role <role...>]
  [--reason <text>] [--verbose] [-j, --json]
actions deny <run-id> [--actor <id>] [--actor-role <role...>]
  [--reason <text>] [--verbose] [-j, --json]
actions execute <run-id> <manifest> [--verbose] [-j, --json]
```

Approval and denial use a human actor whose id defaults to `cli`, with any
provided `--actor-role` values attached. Approval moves the run to `approved`
only after every approval count and role requirement is satisfied; otherwise it
remains `awaiting_approval`. Denial sets status `denied`.

`execute` reloads and registers the supplied `local-shell` manifest so the
stored run has an in-process executor. A denied run remains denied, a dry-run is
previewed again, and an under-approved run returns to `awaiting_approval`.

## Errors and Exit Status

The executable prints an error message to standard error and exits with status
1 when parsing JSON, reading a file, validating a manifest, resolving an id,
planning, approval, denial, or execution fails. Commander also rejects missing
required arguments/options and invalid positive `--limit` values. Successful
commands exit with status 0.
