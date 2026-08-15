# CLI reference

The `sandboxes` binary drives the provider-neutral sandbox lifecycle implemented
by this package.

```text
Usage: sandboxes [options] [command]

Options:
  -v, --version                print version
  -p, --provider <provider>    provider: local|e2b|daytona (default: "local")
  --json                       emit machine-readable JSON (default: false)
  -h, --help                   display help for command
```

Global options precede the command:

```sh
sandboxes --provider local --json list
```

## Providers

| Provider | Credentials | Notes |
| --- | --- | --- |
| `local` | None | Default deterministic simulator; persists under `$SANDBOXES_HOME/instances`, or `$HOME/.hasna/sandboxes/instances` when unset. |
| `e2b` | `E2B_API_KEY` | Reads the environment first, then `secrets get E2B_API_KEY --raw`. |
| `daytona` | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL` | Reads the environment first, then the corresponding `secrets` vault entries. |

The local provider never starts host processes or uses the network. It simulates
`true`, `false`, `echo`, `pwd`, `cat`, `ls`, and simple `sh -c`/`bash -c`
commands; any other command reports a successful `[local-sim] executed: ...`
result. Use E2B or Daytona when the command must really execute.

## Output and errors

Without `--json`, lifecycle commands print concise human-readable text. `exec`
forwards command stdout and stderr directly and exits with the command's nonzero
exit code. `read-file` writes the file's decoded bytes without adding a newline.

With `--json`, commands emit their provider-neutral response object. `read-file`
returns `{ "path": ..., "base64": ... }`; `exec` returns its complete execution
result. Operational failures emit `{ "error": "..." }` to stdout and exit 1.
Commander usage errors are written to stderr.

All numeric CLI inputs below must be non-negative integers. Invalid values fail
before provider resolution.

## Commands

### `create`

```text
Usage: sandboxes create [options]

Options:
  -t, --template <template>   template alias (numeric -t is legacy timeout seconds with -p/-i/-n)
  --timeout <ms>              auto-expire after N milliseconds
  -m, --metadata <kv>         metadata key=value (repeatable)
  -p, --provider <provider>   legacy command-local provider option
  -i, --image <image>         legacy alias for --template
  -n, --name <name>           legacy sandbox name (stored as metadata)
```

`--metadata` may be repeated. Values without `=` are ignored; when a key repeats,
the last value wins.

The compatibility form keeps the pre-v1 create call shape:

```sh
sandboxes create -p e2b -i codewith-pr-drain -n probe -t 600
```

When `-p`, `-i`, or `-n` enables legacy mode, a numeric `-t` means seconds. The
equivalent current syntax uses milliseconds:

```sh
sandboxes --provider e2b create \
  --template codewith-pr-drain \
  --metadata name=probe \
  --timeout 600000
```

Do not combine `--image` with a nonnumeric `--template`, or legacy numeric `-t`
with `--timeout`.

### `list`

```text
Usage: sandboxes list|ls
```

Lists sandboxes for the selected provider. Human output is `id`, status, and
creation timestamp separated by tabs, or `no sandboxes`.

### `get`

```text
Usage: sandboxes get <id>
```

Prints the sandbox ID, status, provider, and creation timestamp.

### `destroy`

```text
Usage: sandboxes destroy|rm|delete <id>
```

Permanently deletes the sandbox.

### `stop`

```text
Usage: sandboxes stop <id>
```

Stops or pauses a sandbox, according to provider semantics.

### `keep-alive`

```text
Usage: sandboxes keep-alive [options] <id>

Required options:
  --timeout <ms>   new lifetime in milliseconds
```

The local and E2B providers update the expiry. The current Daytona backend
accepts this operation but returns the existing record without changing its
lifetime.

### `exec`

```text
Usage: sandboxes exec [options] <id> [cmd...]

Options:
  --cwd <dir>      working directory
  --timeout <ms>   wall timeout in milliseconds
```

At least one command argument is required. Options after the executable are
passed through as command arguments, so place CLI options before the sandbox ID
and executable:

```sh
sandboxes --provider e2b exec --cwd /workspace <id> sh -c 'printf hello'
```

### `logs`

```text
Usage: sandboxes logs <id>
```

Prints event logs as `timestamp [level] event: message`. E2B reads provider
logs, the local simulator returns its lifecycle log, and the current Daytona
backend returns an empty list.

### `write-file`

```text
Usage: sandboxes write-file [options] <id> <path>

Options:
  -c, --content <text>      inline UTF-8 content
  -f, --file <localPath>    read content from a local file
```

`--content` takes precedence over `--file`. The published binary does not install
a default stdin reader, so one of those options is required. Programmatic
`runCli` callers may inject `CliDeps.stdin`; when present, it is used only if
neither option was supplied.

### `read-file`

```text
Usage: sandboxes read-file <id> <path>
```

Human mode decodes the bytes as UTF-8. JSON mode preserves arbitrary bytes as
base64.

### `list-files`

```text
Usage: sandboxes list-files <id> [path]
```

The default path is `/workspace`. Human output prefixes directories with `d`
and files with `-`.

### `expose-port`

```text
Usage: sandboxes expose-port <id> <port>
```

Returns the provider URL for the port.

### `list-ports`

```text
Usage: sandboxes list-ports <id>
```

The local backend returns ports previously exposed in that simulator state.
E2B reports this operation as unsupported because its SDK has no authoritative
enumeration API. The current Daytona backend returns an empty list.

### `snapshot`

```text
Usage: sandboxes snapshot <id>
```

The local backend records a deterministic simulator snapshot. E2B calls the
pinned SDK's `createSnapshot()` when that method is available and otherwise
reports a typed unavailable error. Daytona reports filesystem snapshots as
unsupported in this build.

### `agents`

```text
Usage: sandboxes agents
```

This compatibility command makes no cloud request. It explains that the pre-v1
local agent registry and `init` workflow were removed and points callers to
`exec` or the MCP `run_agent` tool.
