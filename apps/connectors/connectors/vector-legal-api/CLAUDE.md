# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vector-legal-api is a TypeScript connector for the Vector Legal API. It provides a CLI and library for legal document management, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run tests
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.vector-legal.com/v1` (configurable via `VECTOR_LEGAL_API_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>` (api_key credential field)

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Documents | `/documents` | List, create, and retrieve legal documents |
| Events | `/events` | List API events |
| Search | `/search` | Search documents and content |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VECTOR_LEGAL_API_KEY` | API key (overrides profile config) |
| `VECTOR_LEGAL_API_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-vector-legal-api documents list
connect-vector-legal-api documents get <id>
connect-vector-legal-api documents create --body '{"title":"..."}'
connect-vector-legal-api events list
connect-vector-legal-api search --body '{"query":"..."}'
connect-vector-legal-api raw GET /documents
connect-vector-legal-api config set-key <key>
connect-vector-legal-api profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
