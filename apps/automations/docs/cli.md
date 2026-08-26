# CLI Reference

`@hasna/automations` installs two binaries:

- `automations` manages the local automation store and deterministic action
  queue.
- `automations-daemon` maintains a daemon lease and can serve webhook routes.

Run `automations --help`, `automations <group> --help`, or
`automations-daemon --help` for the shipped help text.

## Global Options

Global options must appear before the command.

| Option | Behavior |
| --- | --- |
| `--dir <path>` | Uses `<path>` as the data root for this process. |
| `--json`, `-j` | Writes command results as JSON. Caught command errors are JSON on stderr. |
| `--help`, `-h`, `help` | Prints help. |
| `--version`, `-v`, `version` | Prints the package version. With `--json`, prints `{ "version": "..." }`. |

The default data root is `~/.hasna/automations`, resolved through the
`@hasna/paths` resolver. The environment variables `HASNA_AUTOMATIONS_DIR` and
`AUTOMATIONS_DATA_DIR` override it, in that order; the XDG data home
(`~/.local/share/hasna/automations`, or `$HASNA_DATA_HOME/automations`) is
adopted once the store has been migrated there or `HASNA_DATA_HOME` is set.

## Store Commands

| Command | Behavior |
| --- | --- |
| `init` | Opens or creates the SQLite store and prints status. |
| `status` | Prints store counts and the latest daemon lease. |
| `spec example` | Prints a valid example automation spec. |
| `validate <file>` | Validates a JSON spec. Use `-` to read stdin. |
| `create <file>` | Validates and stores a JSON spec. Existing ids are updated. |
| `list` | Lists stored automation records. |
| `simulate <file> [--event-json <json>] [--persist]` | Previews deterministic ids, or stores and materializes the event with `--persist`. |
| `runtimes` | Lists the built-in OpenLoops runtime binding descriptor. |

`simulate` creates a default event from the first event trigger when
`--event-json` is omitted. Without `--persist`, it does not open the store.

## Runs And Queue

```text
automations runs list [--contract]
automations runs show <run-id> [--contract]
automations queue lease [--runner <id>]
automations queue complete <action-id> [--runner <id>] [--result-json <json>]
automations queue fail <action-id> [--runner <id>] [--code <code>] [--message <text>] [--retryable false] [--retry-backoff-ms <ms>]
automations queue approve <action-id>
automations queue reject <action-id> [--reason <text>]
automations dlq list
automations dlq replay <action-id>
```

`runs --contract` converts run records to `@hasna/contracts` `work_run`
documents and includes persisted queue approval decisions. Queue leases default
to runner id `cli:<pid>` and a 30-second lease. Completion and failure must use
the same runner id while its lease is live. Failures are retryable by default;
an action becomes dead after its maximum attempts. `dlq replay` requeues only
dead actions. Approval and rejection operate only on pending approval gates.

## Webhooks And Recipes

Use `automations webhooks --help` for every route lifecycle and mapping option.
The local `webhooks test` command materializes a delivery, while
`webhooks event` only prints its normalized event envelope. Neither command
verifies HMAC signatures; see [Webhook Ingress](webhooks.md) for signed HTTP
ingress.

```text
automations recipes list
automations recipes render launch-followup --app-id <id> --package <name> --app-version <version> \
  [--campaign-id <id>] [--audience-id <id>] [--sequence-id <id>] [--monitor-id <id>] \
  [--released-at <iso>] [--watch-window-hours <n>] [--engagement-threshold <n>] \
  [--out <dir>] [--create]
```

Rendering returns five specs. `--out <dir>` writes one JSON file per spec and
`--create` registers every rendered spec. Schedule-triggered recipe specs are
inert until a scheduler materializes them; the uptime recipe's
`release.published` event trigger works through current event materialization.

## Daemon

```text
automations-daemon status
automations-daemon run [--once] [--interval-ms <ms>] [--ttl-ms <ms>]
automations-daemon serve [--host <host>] [--port <port>] [--interval-ms <ms>] [--ttl-ms <ms>] [--max-body-bytes <bytes>]
```

`run` and `serve` refresh a lease every 5 seconds with a 15-second TTL by
default. `run --once` records one heartbeat and exits. `serve` defaults to
`127.0.0.1:7391` and a 1 MiB request-body limit. Both long-running commands
stop on `SIGINT` or `SIGTERM`.
