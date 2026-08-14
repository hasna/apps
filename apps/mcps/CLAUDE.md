# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun run build          # Bundle CLI → bin/index.js, MCP → bin/mcp.js, lib → dist/
bun run typecheck      # Type-check without emitting
bun run dev            # Run CLI in dev mode (bun run src/cli/index.tsx)
bun run dev:mcp        # Run MCP server in dev mode
bun test               # Run tests
```

The build is multi-stage: CLI is bundled with `--external ink --external react --external chalk`, MCP server and library are fully bundled, then `tsc --emitDeclarationOnly` generates type declarations.

## Architecture

This is a **meta-MCP system** — it is itself an MCP server that manages, proxies, and aggregates other MCP servers. It has three interfaces to the same core library:

1. **Interactive TUI** (`mcps`) — Ink/React terminal UI for browsing servers, tools, and calling them
2. **Headless CLI** (`mcps list`, `mcps search`, `mcps add`, etc.) — Commander.js commands for scripting
3. **MCP Server** (`mcps mcp` / `mcps-mcp`) — Exposes registry management and tool proxying as MCP tools over stdio

### Core Library (`src/lib/`)

- **`config.ts`** — Constants: `~/.hasna/mcps/` dir, DB path, explicit local storage mode, registry API URL, tool prefix separator (`__`)
- **`db.ts`** — Singleton SQLite via `bun:sqlite` at `~/.hasna/mcps/registry.db`. WAL mode. Core tables include `servers`, `tool_cache`, sources, machines, provider profiles, and feedback
- **`registry.ts`** — CRUD for local server entries. Server IDs are auto-generated slugs from the name. Also manages the `tool_cache` table
- **`remote.ts`** — Client for the official MCP registry API (`registry.modelcontextprotocol.io`). The API returns `{ servers: [{ server: {...}, _meta: {...} }] }` — note the nested `server` wrapper
- **`proxy.ts`** — Connection pooling for upstream MCP servers. Maintains a `Map<string, ConnectedServer>` with MCP SDK clients. Supports stdio/SSE/streamable-http transports. Tools are exposed with prefixed names: `server_id__tool_name`

### Data Flow

User adds server → stored in SQLite → `connectToServer()` spawns process / connects URL → `listTools()` → tools cached in DB → `callTool("server__tool", args)` routes to correct upstream client.

### Key Conventions

- All CLI commands call `closeDb()` after completion
- The `add` command uses `.passThroughOptions()` and `.enablePositionalOptions()` so flags like `-y` pass through to the server command args
- MCP server auto-detects direct execution via `import.meta.url` check
- The proxy stores the MCP SDK `Client` instance as `(connected as any)._client` on the `ConnectedServer` object
- Tool names crossing server boundaries use `__` (double underscore) as separator
- Registry server IDs from the official API use the `server.name` field (e.g., `ai.vendor/server-name`)
- Storage is local SQLite only unless a future mcps-owned storage boundary is implemented. `HASNA_MCPS_STORAGE_MODE` and `MCPS_STORAGE_MODE` must be `local` when set.

## Tech Stack

- **Runtime**: Bun (uses `bun:sqlite`, `bun build`)
- **CLI**: Commander.js with `enablePositionalOptions()`
- **TUI**: Ink 5 + React 18 (`ink-select-input`, `ink-spinner`, `ink-text-input`)
- **MCP**: `@modelcontextprotocol/sdk` — both `server/mcp.js` (for meta-MCP) and `client/index.js` (for proxying)
- **Validation**: Zod (for MCP tool input schemas)
