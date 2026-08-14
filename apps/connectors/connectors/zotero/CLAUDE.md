# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-zotero is a TypeScript CLI and library for the Zotero Web API v3. It provides item, collection, and attachment management with multi-profile API key configuration.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run connector tests
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Async/await for all async operations
- Minimal dependencies: commander, chalk

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with Zotero-API-Key auth
│   ├── items.ts        # Items CRUD and search
│   ├── collections.ts  # Collections list/create
│   ├── attachments.ts  # Attachment create and file upload
│   └── index.ts        # Main Zotero class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # TypeScript types
├── utils/
│   ├── config.ts       # Multi-profile configuration
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOTERO_API_KEY` | Zotero API key (Zotero-API-Key header) |
| `ZOTERO_LIBRARY_ID` | User or group library ID |
| `ZOTERO_LIBRARY_TYPE` | `users` (default) or `groups` |
| `ZOTERO_BASE_URL` | Optional override (default https://api.zotero.org) |

## Authentication

Auth type: **apikey** (no OAuth). Config dir: `~/.hasna/connectors/connect-zotero/profiles/{name}/config.json`

## API Notes

- Base URL: https://api.zotero.org
- Required headers: `Zotero-API-Key`, `Zotero-API-Version: 3`
- Update/delete require `If-Unmodified-Since-Version` with the item version
- File upload uses a 3-step protocol: auth POST → S3 POST → register POST

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
