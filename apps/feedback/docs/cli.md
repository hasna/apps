# CLI Reference

The package installs three binaries:

- `feedback`: collect, inspect, triage, and export feedback; it can also start the HTTP API.
- `feedback-serve`: start only the HTTP API.
- `feedback-mcp`: start the MCP server over standard input/output.

Run `feedback --help`, `feedback <command> --help`, `feedback-serve --help`, or
`feedback-mcp --help` for generated help. All three binaries support `-V` and
`--version`; `-h` and `--help` display help.

## Storage Selection

Commands use local JSONL storage unless `--api-url <url>` is present. Remote
commands use `--token <token>` when supplied, otherwise they read
`FEEDBACK_API_TOKEN`. A token without `--api-url` does not change the local
storage path.

Remote options are available on `submit`, `list`, `show`, `status`, `stats`, and
`export`. `init`, `doctor`, `serve`, and `shipped` do not accept them.

Local commands honor `FEEDBACK_DATA_DIR` and the storage runtime selected by
`FEEDBACK_STORE` or `FEEDBACK_STORAGE_BACKEND`. The packaged CLI cannot inject a
cloud adapter, so selecting cloud mode makes local storage commands fail closed.
Use `--api-url` to operate against a host application that injected a cloud
`FeedbackStore`.

## `feedback init`

Creates the parent directory for the local feedback file and prints its path as
JSON. It does not create the JSONL file.

```bash
feedback init
```

## `feedback doctor`

Prints a redacted JSON readiness report containing:

- package version and selected storage runtime;
- local file path, directory writability, and file readability in local mode;
- whether `FEEDBACK_API_TOKEN` is configured;
- cloud setting presence and readiness blockers; and
- resolved paths for `feedback`, `feedback-mcp`, and `feedback-serve`.

```bash
feedback doctor
```

Sensitive token, DSN, ARN, and secret values are never included in the report.

## `feedback serve`

Starts the HTTP API from the main CLI.

```text
feedback serve [options]

--host <host>  Host to bind (default: 127.0.0.1)
--port <port>  Port to bind (default: 8787)
```

`FEEDBACK_HOST` and `FEEDBACK_PORT` are used by the server API when explicit
values are not passed. The `feedback serve` command always supplies its own
defaults, so use `feedback-serve` when you want those environment variables to
select the bind address.

## `feedback submit`

Submits one feedback entry and prints the created item as JSON.

```text
feedback submit [options] <message>

--app <appId>              Application id (required)
--kind <kind>              bug, idea, question, praise, or other
--severity <severity>      low, medium, high, or critical
--user <userId>            User id
--email <email>            User email
--url <url>                Related URL
--rating <rating>          Integer rating from 1 to 5
--tag <tag...>             Repeated or comma-separated tags
--metadata <json>          Metadata as a JSON object
--meta <key=value...>      Repeated metadata key/value pairs
--route <route>            Current app route
--screen <screen>          Current app screen
--app-version <version>    App version or build id
--env <environment>        App environment
--context <key=value...>   Repeated context key/value pairs
--api-url <url>            Remote Open Feedback API URL
--token <token>            API bearer token
```

`--meta` values override matching keys from `--metadata`. Explicit route,
screen, app-version, and environment options override matching values from
`--context`. Tags are normalized to lowercase, deduplicated, and sorted during
validation.

```bash
feedback submit "Export failed" \
  --app my-app \
  --kind bug \
  --severity high \
  --tag reports,export \
  --route /reports \
  --meta plan=pro
```

## `feedback list`

Prints matching entries as a JSON array, newest first.

```text
feedback list [options]

--app <appId>       Filter by app id
--status <status>   new, triaged, shipped, or closed
--tag <tag>         Filter by normalized tag
--search <text>     Search message, metadata, context, tags, and core fields
--since <date>      Entries created at or after the parsed date
--until <date>      Entries created at or before the parsed date
--limit <n>         Maximum results (default: 50; clamped to 1-500)
--api-url <url>     Remote Open Feedback API URL
--token <token>     API bearer token
```

Invalid date filters are ignored by local storage. The HTTP API applies the same
storage filtering after parsing query parameters.

## `feedback show`

Prints one item as JSON. A missing local item prints an error and sets a nonzero
exit code; a missing remote item is returned as an API error.

```text
feedback show [options] <id>

--api-url <url>  Remote Open Feedback API URL
--token <token>  API bearer token
```

## `feedback status`

Updates an item to `new`, `triaged`, `shipped`, or `closed`, then prints the
updated item.

```text
feedback status [options] <id> <status>

--api-url <url>  Remote Open Feedback API URL
--token <token>  API bearer token
```

A non-`new` local status update emits `feedback.triaged`. Setting `shipped`
through this command does not create `changelogRef` or `shippedAt`; use the
local-only `shipped` command when changelog linkage is required.

## `feedback shipped`

Marks a local item shipped, records its changelog linkage, and prints the
updated item.

```text
feedback shipped <id> --changelog-ref <ref>

--changelog-ref <ref>  Changelog entry id or URI (required)
```

This command sets `status` to `shipped`, writes `changelogRef` and `shippedAt`,
and emits `feedback.triaged` with disposition `shipped`. It has no remote mode
because the HTTP API has no shipped-linkage endpoint.

## `feedback stats`

Prints total counts grouped by app, kind, status, and severity.

```text
feedback stats [options]

--api-url <url>  Remote Open Feedback API URL
--token <token>  API bearer token
```

## `feedback export`

Writes filtered feedback to standard output.

```text
feedback export [options]

--app <appId>       Filter by app id
--status <status>   new, triaged, shipped, or closed
--tag <tag>         Filter by normalized tag
--search <text>     Search message, metadata, context, tags, and core fields
--since <date>      Entries created at or after the parsed date
--until <date>      Entries created at or before the parsed date
--limit <n>         Maximum results (default: 500; clamped to 1-500)
--format <format>   json or jsonl (default: jsonl)
--api-url <url>     Remote Open Feedback API URL
--token <token>     API bearer token
```

`json` prints a formatted array. `jsonl` writes one compact object per line and
adds a trailing newline when at least one item exists.

## Standalone Servers

`feedback-serve` starts the HTTP API and reads `FEEDBACK_HOST` and
`FEEDBACK_PORT` when the matching option is omitted:

```text
feedback-serve [options]

--host <host>  Host to bind (default: 127.0.0.1)
--port <port>  Port to bind (default: 8787)
```

`feedback-mcp` has no runtime options beyond help and version. It starts an MCP
server using standard input/output and must not write regular output to stdout.
