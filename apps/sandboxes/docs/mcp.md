# MCP server reference

The `sandboxes-mcp` binary exposes the same provider-neutral lifecycle as the
CLI. Every provider operation accepts an optional `provider` value of `local`,
`e2b`, or `daytona`; omitted providers default to `local`. The `version` and
`health` schemas have no inputs.

## Transport

The binary serves Streamable HTTP by default:

```text
http://127.0.0.1:8875/mcp
```

```sh
# Default HTTP transport
sandboxes-mcp

# Explicit port forms
sandboxes-mcp --port 9000
sandboxes-mcp --port=9000

# Stdio transport
sandboxes-mcp --stdio
```

`MCP_HTTP_PORT` supplies the HTTP port when `--port` is absent. Valid ports are
integers from 0 through 65535; port 0 asks the operating system for an available
port. `--stdio` or `MCP_STDIO=1` selects stdio and takes precedence over HTTP.
`--http` and `MCP_HTTP=1` appear in compatibility help for the already-default
HTTP mode; mode selection only needs to test the stdio flag or environment
variable. The CLI host is fixed at `127.0.0.1`; programmatic callers can pass a
different `hostname` to `startSandboxesHttpServer`.

`-h`/`--help` prints help. `-V`/`--version` reports the version from
`package.json`, which is also used in the MCP initialize response and the
`version` and `health` tools.

## Responses and errors

Tool results are JSON serialized into one MCP text-content item. Operational
errors return a JSON `{ "error": "..." }` text item with `isError: true`.
Unknown tool names and unknown providers follow the same error shape.

See [provider behavior](providers.md) for operations that are simulated,
unsupported, or intentionally empty for a particular backend.

## Tools

The following input fields match the schemas returned by `tools/list`.

| Tool | Inputs | Behavior |
| --- | --- | --- |
| `create_sandbox` | `provider?`, `template?`, `timeout_ms?`, `metadata?` | Creates a sandbox. `metadata` is an object whose values are strings. |
| `list_sandboxes` | `provider?` | Lists sandboxes for one provider. |
| `get_sandbox` | `provider?`, `sandbox_id` | Returns provider-neutral sandbox details. |
| `delete_sandbox` | `provider?`, `sandbox_id` | Deletes the sandbox and returns `deleted: true`. |
| `stop_sandbox` | `provider?`, `sandbox_id` | Stops or pauses the sandbox. |
| `keep_alive` | `provider?`, `sandbox_id`, `timeout_ms` | Requests a new lifetime in milliseconds. |
| `exec_command` | `provider?`, `sandbox_id`, `command`, `cwd?`, `timeout_ms?` | Executes a command and returns exit code, stdout, stderr, session ID, and completion state. |
| `read_file` | `provider?`, `sandbox_id`, `path` | Returns both UTF-8 `content` and `content_base64`. |
| `write_file` | `provider?`, `sandbox_id`, `path`, `content?`, `content_base64?` | Writes bytes and returns path, size, and SHA-256 receipt. Base64 takes precedence; absent content writes an empty file. |
| `list_files` | `provider?`, `sandbox_id`, `path?` | Lists the directory; `path` defaults to `/workspace`. |
| `get_logs` | `provider?`, `sandbox_id` | Returns provider-normalized log entries. |
| `expose_port` | `provider?`, `sandbox_id`, `port` | Returns a URL for one sandbox port. |
| `list_exposed_ports` | `provider?`, `sandbox_id` | Lists known forwarded ports when the provider supports enumeration. |
| `snapshot_sandbox` | `provider?`, `sandbox_id` | Captures a filesystem snapshot when supported. |
| `upload_dir` | `provider?`, `sandbox_id`, `local_dir`, `dest?` | Recursively uploads non-directory entries; `dest` defaults to `/workspace`. |
| `run_agent` | `provider?`, `sandbox_id`, `prompt`, `agent?`, `args?` | Executes `[agent, ...args, prompt]`; `agent` defaults to `agent`. |
| `version` | none | Returns package name, server name, version, and providers. |
| `health` | none | Returns `status: "ok"` and the package version. |

`command` may be either a string or an argv array. String commands execute as
`sh -c <command>`; array values are converted to strings and passed as argv.

### Host filesystem boundary

`upload_dir` reads `local_dir` from the MCP server host, recursively, before
calling the selected backend's file-write operation. Expose this tool only to
trusted clients and only with a server account whose filesystem permissions are
appropriately restricted. The tool does not implement an allowlist or sandbox
for host paths.

## Programmatic server

The source entry point exports:

- `createSandboxesMcpServer(deps?)` for an unconnected MCP `Server`.
- `startSandboxesHttpServer({ port?, hostname?, deps? })` for Streamable HTTP.
- `SANDBOX_TOOLS` for the exact tool definitions.
- `DEFAULT_MCP_HTTP_PORT`, `MCP_VERSION`, `isStdioMode`, and
  `resolveMcpHttpPort` for launch integration and tests.

These are bin-module exports, not package subpath exports in `package.json`.
