# mcps

Meta-MCP registry & CLI — discover, manage, and proxy MCP servers from a single interface. It is itself an MCP server, so AI agents can use it to discover and call tools from any registered MCP.

## Install

```bash
npm install -g @hasna/mcps
```

## Quick Start

```bash
# Add MCP servers
mcps add --name "GitHub" npx -y @modelcontextprotocol/server-github
mcps add --name "Filesystem" npx -y @modelcontextprotocol/server-filesystem

# List registered servers
mcps list

# Search the official MCP registry
mcps search "database"

# Connect and list all tools
mcps tools --connect

# Call a tool directly
mcps call github__create_issue --json '{"repo":"owner/repo","title":"Bug"}'

# Launch the web dashboard
mcps serve

# Launch the interactive TUI
mcps

# Start the meta-MCP server (for AI agents)
mcps mcp
```

## Web Dashboard

A local web dashboard for managing your MCP servers — built with React, shadcn/ui, and Tailwind CSS.

```bash
mcps serve              # Opens http://localhost:19427
mcps serve --port 3000  # Custom port
```

Features: stats overview, sortable/filterable data table, enable/disable servers, add new servers, dark/light theme, pagination.

## CLI Commands

| Command | Description |
|---------|-------------|
| `mcps` | Launch interactive TUI |
| `mcps list` | List registered MCP servers |
| `mcps search <query>` | Search official MCP registry |
| `mcps add <command> [args...]` | Add a local MCP server |
| `mcps add --from-registry <id>` | Install from official registry |
| `mcps remove <id>` | Remove a registered server |
| `mcps enable <id>` | Enable a server |
| `mcps disable <id>` | Disable a server |
| `mcps tools [server-id]` | List tools (cached or `--connect` for live) |
| `mcps call <tool> [--json]` | Call a tool directly |
| `mcps info <id>` | Show server details & tools |
| `mcps status` | Show registry stats |
| `mcps serve` | Start web dashboard |
| `mcps mcp` | Start meta-MCP server (stdio) |

## Architecture

```
┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────────────┐
│   Ink TUI        │  │   Headless CLI       │  │   MCP Server (meta)      │
│   `mcps`         │  │   `mcps search`      │  │   `mcps mcp`             │
└────────┬─────────┘  └──────────┬───────────┘  └──────────┬───────────────┘
         │                       │                         │
         └───────────┬───────────┴─────────────────────────┘
                     │
             ┌───────▼────────┐
             │  Core Library   │
             │  - Registry     │  ← SQLite (local MCPs)
             │  - Remote       │  ← Official MCP Registry API
             │  - Proxy        │  ← MCP SDK Client (connect to MCPs)
             └────────────────┘
```

**Data flow:** User adds server → stored in SQLite (`~/.mcps/registry.db`) → `connectToServer()` spawns process → `listTools()` → tools cached → `callTool("server__tool", args)` routes to correct upstream.

## Meta-MCP Server

When running as an MCP server (`mcps mcp`), it exposes:

**Management tools:** `list_servers`, `search_registry`, `add_server`, `install_from_registry`, `remove_server`, `enable_server`, `disable_server`, `get_server_info`

**Proxy tools:** `connect_and_list_tools`, `call_upstream_tool` — calls are routed to the correct upstream server using prefixed tool names (`server_id__tool_name`)

## Library Usage

```typescript
import { addServer, connectToServer, listAllTools, callTool } from "@hasna/mcps";

const server = addServer({
  name: "GitHub",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
});

await connectToServer(server);
const tools = listAllTools();
const result = await callTool("github__create_issue", { repo: "owner/repo", title: "Bug" });
```

## Development

```bash
bun install
bun run dev            # Run CLI in dev mode
bun run dev:mcp        # Run MCP server in dev mode
bun run dev:dashboard  # Run dashboard in dev mode (Vite)
bun run serve          # Run dashboard server
bun test               # Run tests (127 tests)
bun run typecheck      # Type-check
bun run build          # Build everything
```

## License

Apache-2.0
