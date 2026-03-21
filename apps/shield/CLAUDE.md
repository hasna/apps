# security

AI-powered security scanner for git repos.

## Architecture

Monorepo with 5 surfaces sharing a single SQLite database:
- **CLI** (`src/cli/`) — Commander.js + React/Ink TUI
- **MCP** (`src/mcp/`) — Model Context Protocol server (stdio)
- **API** (`src/server/`) — Express REST API
- **Web** (`dashboard/`) — React SPA (Vite + TailwindCSS + Radix UI)
- **SDK** (`sdk/`) — REST client package (@hasnaxyz/security-sdk)

## Data Flow

All surfaces call directly into `src/db/` functions. No intermediate service layer.

## Stack

- Runtime: Bun
- Language: TypeScript (strict)
- Database: SQLite (better-sqlite3, WAL mode)
- LLM: Cerebras API (OpenAI-compatible, via openai SDK)
- MCP: @modelcontextprotocol/sdk

## Key Directories

- `src/types/` — All TypeScript interfaces and enums
- `src/db/` — SQLite schema, migrations, CRUD modules
- `src/scanners/` — Scanner modules (secrets, deps, code, git-history, config, ai-safety)
- `src/llm/` — Cerebras LLM integration (analyzer, explainer, fixer, triager)
- `src/reporters/` — Output formats (terminal, JSON, SARIF)
- `src/lib/` — Config, search, sync utilities

## Commands

```bash
bun install                  # Install deps
bun test                     # Run tests
bun run dev:cli              # CLI dev mode
bun run dev:mcp              # MCP server dev mode
bun run dev:serve            # REST API + dashboard dev mode
bun run build                # Build all
```

## Database Location

env `SECURITY_DB` → `.security/security.db` → `~/.security/security.db`

## Cerebras API

Set `CEREBRAS_API_KEY` in env or `~/.secrets`. LLM features gracefully degrade when key is not set.
