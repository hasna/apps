# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-withai is a TypeScript connector for the WithAI API. It provides a CLI and library for asset-manager command center operations: workspaces, research tasks, document search, portfolio alerts, and integrations.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run connector tests
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.withai.co/v1` (configurable via `WITHAI_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`
- **Docs**: https://withai.co

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Workspaces | `/workspaces` | List and retrieve workspaces |
| Research Tasks | `/workspaces/:id/research-tasks`, `/research-tasks/:id` | Create and monitor research tasks |
| Documents | `/documents/search` | Search documents across workspaces |
| Portfolio | `/portfolio/alerts` | Create portfolio alerts |
| Integrations | `/integrations` | List connected integrations |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WITHAI_API_KEY` | API key (overrides profile config) |
| `WITHAI_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-withai workspaces list
connect-withai workspaces get <workspaceId>
connect-withai research-tasks create <workspaceId> --ticker MSFT --prompt "update model"
connect-withai research-tasks get <taskId>
connect-withai documents search --search-text "channel checks" --filters '{"ticker":"MSFT"}'
connect-withai portfolio alerts create --ticker MSFT --threshold "guidance change"
connect-withai integrations list
connect-withai raw --path /custom/command-center --method POST --body '{"enabled":true}'
connect-withai config set-key <key>
connect-withai profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
