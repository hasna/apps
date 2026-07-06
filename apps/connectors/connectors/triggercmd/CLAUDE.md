# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-triggercmd is a TypeScript connector for the TRIGGERcmd REST API. It provides a CLI and library for listing computers and commands, triggering remote commands, and viewing run history.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check

# Run specific commands
bun run dev config show
bun run dev computers list
bun run dev commands commandlist
bun run dev commands list --computer-id <id>
bun run dev trigger run <computer> <trigger> [--params <value>]
bun run dev runs list [--command-id <id>] [--sort-on createdAt,DESC]
bun run dev profile list
```

## Authentication

Bearer token authentication. Obtain your personal API token from the TRIGGERcmd Instructions page at https://www.triggercmd.com.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRIGGERCMD_API_KEY` | API token (overrides profile) |
| `TRIGGERCMD_TOKEN` | Alias for API token |

## API Details

- **Base URL**: `https://www.triggercmd.com`
- **Auth**: `Authorization: Bearer <token>`
- **Endpoints**:
  - `GET /api/computer/list` - List registered computers
  - `POST /api/command/list` - List commands for a computer (`{computer_id}`)
  - `POST /api/command/commandlist` - List all commands across computers
  - `POST /api/run/triggerSave` - Trigger a command (`{computer, trigger, params?}`)
  - `GET /api/run/list` - Run history (`sortOn`, `command_id` query params)

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth, retry, timeout
│   ├── commands.ts   # Commands API (list, commandlist)
│   ├── trigger.ts    # Trigger API (run)
│   ├── runs.ts       # Runs API (list)
│   ├── computers.ts  # Computers API (list)
│   └── index.ts      # Main Connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Data Storage

```
~/.hasna/connectors/connect-triggercmd/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
