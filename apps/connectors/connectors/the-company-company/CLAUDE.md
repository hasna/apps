# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-the-company-company is a TypeScript connector for The Company Company API. It provides a CLI and library for managing business agents, tasks, integrations, memories, and events.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.thecompany.company/v1` (configurable via `THE_COMPANY_COMPANY_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`
- **Product**: Business agent platform for automation and integrations

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Agents | `/agents` | Business agents |
| Tasks | `/tasks` | Agent tasks |
| Integrations | `/integrations` | Connected business integrations |
| Memories | `/memories` | Agent memories |
| Events | `/events` | Agent event log |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THE_COMPANY_COMPANY_API_KEY` | API key (overrides profile config) |
| `THE_COMPANY_COMPANY_BASE_URL` | Optional custom API base URL |

## CLI Commands

```bash
connect-the-company-company agents list
connect-the-company-company agents get <id>
connect-the-company-company agents create --name <name>
connect-the-company-company tasks list
connect-the-company-company tasks get <id>
connect-the-company-company tasks create --agent-id <id> --prompt <text>
connect-the-company-company tasks cancel <id>
connect-the-company-company integrations list
connect-the-company-company integrations connect --json '{}'
connect-the-company-company memories list
connect-the-company-company memories create --json '{}'
connect-the-company-company events list
connect-the-company-company events get <id>
connect-the-company-company raw --path /agents
connect-the-company-company config set-key <key>
connect-the-company-company profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
