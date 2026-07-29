# MCP reference

The `servers-mcp` binary exposes the same SQLite-backed registry and local lifecycle primitives as MCP tools. It uses stdio by default and can run as a stateless Streamable HTTP server.

## Command help

```text
Usage: servers-mcp [options]

Start the @hasna/servers MCP server (stdio by default).

Options:
  --http         Serve MCP over Streamable HTTP on 127.0.0.1
  --port <n>     HTTP port (--http or MCP_HTTP=1; default: 8834)
  -h, --help     display help for command
  -V, --version  output the version number

Environment:
  MCP_HTTP=1         Enable HTTP mode
  MCP_HTTP_PORT=<n>  HTTP port when MCP_HTTP=1
```

`--port` takes precedence over `MCP_HTTP_PORT`. Ports must be integers from 1 through 65535. The database follows the same selection rules as the CLI; see [Database](database.md).

## Transports

### Stdio

```bash
servers-mcp
```

Configure an MCP client to launch that executable and communicate over stdin/stdout.

### Streamable HTTP

```bash
servers-mcp --http
servers-mcp --http --port 9000
MCP_HTTP=1 MCP_HTTP_PORT=9000 servers-mcp
```

The HTTP listener is always bound to `127.0.0.1`. It provides:

- `GET /health` returning `{"status":"ok","name":"servers"}`.
- `GET /mcp` and `POST /mcp` for Streamable HTTP MCP requests.
- `404 Not Found` for other routes.

Each `/mcp` request creates a fresh MCP server and transport. No MCP session ID is generated, and JSON responses are enabled.

## Tool output

All 46 tools return MCP text content. Errors are returned as tool errors with the underlying message.

List tools accept `limit`, `cursor`, and `verbose` where applicable. The default limit is 20, the cursor is a zero-based offset, and the response footer includes total rows and the next cursor. Detail values are truncated in compact list output. Call the matching `get_*` tool for full details.

Registry CRUD tools perform exact entity lookups: servers by full ID or slug, agents by full ID or exact name, projects by full ID or exact path, and other entities by full ID. The local lifecycle tools additionally resolve a server by unambiguous UUID prefix or exact name.

## Server tools

- `create_server` — register a server with name, optional slug/host/path/description/status/project, and metadata.
- `get_server` — get a server by full ID or slug, including a computed Tailscale URL when configured.
- `list_servers` — list servers, optionally filtered by project, with pagination and verbose output.
- `update_server` — update mutable server fields and metadata.
- `delete_server` — delete an unlocked server.
- `lock_server` — lock a server for an agent.
- `unlock_server` — unlock a server held by an agent.
- `server_heartbeat` — update a server's heartbeat.

## Agent tools

- `register_agent` — register or reclaim an agent with optional session, working directory, capabilities, description, and metadata.
- `get_agent` — get an agent by full ID or exact name.
- `list_agents` — list agents, optionally filtered by `active` or `archived` status.
- `agent_heartbeat` — update an agent's heartbeat.
- `archive_agent` — archive an agent and clear its session.
- `release_agent` — clear an agent's session and refresh its last-seen timestamp without archiving it.

## Operation tools

- `create_operation` — create a pending operation for a server.
- `get_operation` — get an operation by full ID.
- `list_operations` — list operations by optional server and status filters.
- `start_operation` — transition a pending operation to running.
- `complete_operation` — mark an operation completed.
- `fail_operation` — mark an operation failed with a message.
- `cancel_operation` — cancel a pending or running operation.
- `delete_operation` — delete an operation.

## Trace tools

- `create_trace` — append an audit event for a server with optional operation, agent, and detail data.
- `get_trace` — get a trace by full ID.
- `list_traces` — list traces, optionally filtered by server.
- `list_traces_by_agent` — list traces for an agent.

## Project tools

- `create_project` — register a project path and name.
- `get_project` — get a project by full ID or exact path.
- `list_projects` — list projects with pagination.
- `update_project` — update project name, path, or description.
- `delete_project` — delete a project.

## Webhook tools

- `create_webhook` — create an HTTPS webhook with event and entity scopes plus an optional HMAC secret.
- `get_webhook` — get a webhook with its secret redacted.
- `list_webhooks` — list webhooks with secrets redacted.
- `delete_webhook` — delete a webhook.
- `list_deliveries` — list delivery attempts, optionally for one webhook, with sensitive payload fields redacted.

Webhook URL validation and delivery protections are described in the [CLI webhook reference](cli.md#webhooks).

## Resource lock tools

- `acquire_lock` — acquire a shared or exclusive lock on a typed resource with an optional TTL.
- `release_lock` — release a lock held by an agent.
- `check_lock` — inspect a resource lock after expired locks are cleaned.
- `locks_by_agent` — list locks held by an agent.
- `clean_expired_locks` — remove all expired resource locks.

These general resource locks are separate from the server row lock used by `lock_server` and the `server-runtime` lock used by local lifecycle operations.

## Local lifecycle tools

- `init_local_server` — detect or configure a local app, create its project when needed, and register it offline.
- `start_local_server` — start a local app process with optional readiness waiting and lifecycle locking.
- `stop_local_server` — stop the discovered process tree.
- `restart_local_server` — stop and replace the discovered process tree.
- `get_local_server_status` — inspect current process and readiness state.

The lifecycle tools accept the same underlying command, cwd, port, health/readiness URL, environment, timeout, wait, force, and lock controls as the SDK lifecycle helpers. See [Local runtime](runtime.md) for exact semantics and production-mode restrictions.
