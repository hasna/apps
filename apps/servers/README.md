# @hasna/servers

Server management for AI coding agents — CLI + MCP server.

## Overview

Manage servers, local app processes, agents, operations, projects, webhooks, locks, and audit trails across repositories. Built on SQLite with global defaults and nearest-project database discovery.

## Features

- **Server lifecycle**: online, offline, starting, stopping, restarting, deploying, maintenance
- **Agent registration**: conflict detection, stale takeover (30 min), session binding
- **Resource locking**: advisory/exclusive locks with auto-expiry
- **Operations**: state machine (pending → running → completed/failed/cancelled)
- **Webhooks**: HTTPS-only with SSRF prevention, HMAC signing, retry with exponential backoff
- **Audit trails**: trace events by server, operation, or agent
- **Database discovery**: explicit path, nearest existing `.servers/servers.db`, optional git-root project scope, then a user-global default
- **MCP server**: stdio by default or stateless Streamable HTTP bound to localhost
- **CLI**: Commander.js interface with colored output

## Documentation

- [CLI reference](docs/cli.md) — global options, all local commands, aliases, and output behavior
- [MCP reference](docs/mcp.md) — transports, endpoints, and all tools
- [Local runtime](docs/runtime.md) — detection, metadata, readiness, locking, and process safety
- [Database](docs/database.md) — path precedence, schema behavior, and concurrency

## CLI

See the [CLI reference](docs/cli.md) for the complete command and option surface.

```bash
# List servers
servers servers

# Show more rows or continue a paginated list
servers servers --limit 50
servers servers --cursor 20

# Create a server
servers servers:add --name "api-server" --project "my-project"

# Register a Tailscale-accessible server
servers servers:add --name "api-server" --tailscale-hostname spark01 --tailscale-port 3000

# Register an agent
servers agent:register --name "marcus" --description "architect"

# List operations
servers operations --server "api-server"

# Create a webhook
servers webhook:add --url "https://hooks.example.com/notify" --events "server.started"

# Show webhook delivery logs
servers webhooks:logs
```

### CLI Output Defaults

Read/list commands are compact by default for agent terminals. Human table output shows essential columns, truncates long values, and limits list-style commands to 20 rows unless you pass `--limit`. When more rows are available, the footer prints the next `--cursor` value.

Use `--verbose` for extra columns, entity detail commands for full human-readable records, and `--json` for machine-readable output:

```bash
servers servers --verbose
servers servers:get api-server
servers agent:get marcus
servers operation:get <operation-id>
servers trace:get <trace-id>
servers project:get <project-id-or-path>
servers webhook:get <webhook-id>
servers operations --json
```

Existing JSON shapes are preserved. For unbounded entity lists such as `servers --json`, JSON remains complete by default; pass `--limit` and `--cursor` when an agent needs bounded JSON.

### Local App Server Lifecycle

Agents should use the lifecycle commands for long-running dev/app servers instead of starting processes directly. The commands create operations, write traces, claim a `server-runtime` lock, wait for readiness, and record PID/log metadata.

See [Local runtime](docs/runtime.md) for auto-detection order, readiness fallbacks, defaults, and stop/restart safety behavior.

```bash
# Detect or register the current repo's app server
servers servers:init --name platform-alumia --path . --command "bun run dev --host 0.0.0.0" --port 7010

# Start and wait for readiness
servers servers:start platform-alumia --agent diocletian --reason "verify billing flow"

# Inspect current process/readiness state
servers servers:status platform-alumia --refresh
servers servers:debug platform-alumia
servers servers:logs platform-alumia --lines 80

# Restart or stop safely
servers servers:restart platform-alumia --agent diocletian --reason "env changed"
servers servers:stop platform-alumia --agent diocletian --reason "done testing"
```

For apps that need to be reachable from other machines, make the app command bind to `0.0.0.0` and set the managed port. `servers` records the local health check and exposes computed Tailscale URLs from `tailscale_hostname`/`tailscale_port` metadata.

### Runtime Conventions

`@hasna/servers` separates local process management from production cloud-backed runtime reporting.

Local runtime records use `runtime_mode: "local"`. In this mode the package may start, stop, restart, inspect, and log a local process. The default bind/probe behavior is local-first: bind host `127.0.0.1`, probe host `127.0.0.1`, `PORT` for the managed port, `/health` for health, and `/ready` for readiness. `servers:init` writes these convention fields into server metadata and lifecycle readiness checks use `readiness_url` when present, falling back to `health_url` for older health-only records.

Production cloud-backed records use `runtime_mode: "production-cloud"`. In this mode the process is owned by the hosting platform, not by `@hasna/servers`. The package records config and health/readiness metadata, but local lifecycle calls refuse to start, stop, restart, deploy, expose, or mutate production infrastructure. Use platform-owned deployment and approval workflows for live changes.

Stable metadata and environment keys:

- `runtime_mode`: `local` or `production-cloud`
- `process_owner`: `hasna-servers` or `external-platform`
- `bind_host`: local listener host, defaulting to `127.0.0.1` for local and `0.0.0.0` for production cloud-backed runtime
- `probe_host`: health probe host, defaulting to `127.0.0.1`
- `port` / `PORT`: runtime port
- `health_path` / `SERVERS_HEALTH_PATH`: default `/health`
- `readiness_path` / `SERVERS_READINESS_PATH`: default `/ready`
- `health_url` / `SERVERS_HEALTH_URL`: explicit health endpoint when path+port defaults are not enough
- `readiness_url` / `SERVERS_READINESS_URL`: explicit readiness endpoint when path+port defaults are not enough
- `public_url` / `SERVERS_PUBLIC_URL`: externally routed URL, if one exists

SDK helpers keep packages on the same contract:

```typescript
import {
  resolveServerRuntimeConvention,
  runtimeMetadataFromConvention,
} from "@hasna/servers";

const runtime = resolveServerRuntimeConvention({
  mode: process.env.SERVERS_RUNTIME_MODE,
  env: process.env,
});

const metadata = runtimeMetadataFromConvention(runtime);
```

## MCP

See the [MCP reference](docs/mcp.md) for all 46 tools and their behavior.

Run as MCP server with stdio transport (default):

```bash
servers-mcp
```

### HTTP mode

Long-lived shared HTTP server (Streamable HTTP, stateless):

```bash
servers-mcp --http
# or: MCP_HTTP=1 servers-mcp

# Custom port (default 8834)
servers-mcp --http --port 8834
```

Endpoints (bound to `127.0.0.1` only):

- `GET /health` → `{"status":"ok","name":"servers"}`
- `GET /mcp` and `POST /mcp` — MCP Streamable HTTP endpoint

Lifecycle MCP tools:

- `init_local_server`
- `start_local_server`
- `stop_local_server`
- `restart_local_server`
- `get_local_server_status`

MCP list tools also default to compact output. Use `limit`, `cursor`, and `verbose=true` on list tools, or call the corresponding `get_*` tool for a detail view.

## SDK

```typescript
import {
  createServer,
  getServer,
  registerAgent,
  listAgents,
  startLocalServer,
  stopLocalServer,
} from "@hasna/servers";

const server = createServer({ name: "api-server" });
const agent = registerAgent({ name: "marcus", capabilities: ["review"] });
await startLocalServer(server.id, { agentId: agent.id, reason: "local verification" });
await stopLocalServer(server.id, { agentId: agent.id, reason: "verification complete" });
```

## Database

SQLite via `bun:sqlite` with WAL mode. Database location:
1. `SERVERS_DB_PATH` env var
2. Nearest existing `.servers/servers.db` walking up from cwd
3. `<git-root>/.servers/servers.db` when `SERVERS_DB_SCOPE=project`
4. `~/.hasna/servers/servers.db` (default; `USERPROFILE` is used when `HOME` is unavailable)

See [Database](docs/database.md) for initialization and concurrency details.

## Install

```bash
bun add -g @hasna/servers
```
