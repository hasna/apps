# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-smol-machines is a TypeScript connector for the smol machines / smolvm HTTP API. It manages portable microVM lifecycle operations: create, start, stop, exec, and delete machines.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run connector tests
```

## API Reference

- **Hosted base URL**: `https://api.smolmachines.com/v1`
- **Local smolvm base URL**: `http://127.0.0.1:8080/api/v1`
- **Auth**: Optional Bearer token (`Authorization: Bearer <key>`) for hosted API; omit for local smolvm
- **Endpoints**: `/machines` CRUD, start/stop, exec

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|set-base-url\|show\|clear` | Manage configuration |
| `list-machines` | List all machines |
| `create-machine` | Create a machine |
| `get-machine` | Get machine details |
| `start-machine` | Start a machine |
| `stop-machine` | Stop a machine |
| `exec-machine` | Execute command in a machine |
| `delete-machine` | Delete a machine |
| `raw-request` | Arbitrary API request |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SMOL_MACHINES_API_KEY` | API key for hosted API (optional) |
| `SMOL_MACHINES_BASE_URL` | Override base URL |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
