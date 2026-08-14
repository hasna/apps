# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vector-legal is a TypeScript connector for the Vector Legal API. It provides a CLI and library for legal document management, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.vector-legal.com/v1` (configurable via `VECTOR_LEGAL_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Documents | `/documents` | List, create, and retrieve legal documents |
| Events | `/events` | List platform events |
| Search | `/search` | Search documents and content |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VECTOR_LEGAL_API_KEY` | API key (overrides profile config) |
| `VECTOR_LEGAL_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-vector-legal documents list              # List documents
connect-vector-legal documents get <id>          # Get document by ID
connect-vector-legal documents create            # Create a document
connect-vector-legal events list                 # List events
connect-vector-legal search --query <text>       # Search documents
connect-vector-legal raw --path /documents       # Raw API request
connect-vector-legal config set-key <key>        # Set API key
connect-vector-legal profile list                # List profiles
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
