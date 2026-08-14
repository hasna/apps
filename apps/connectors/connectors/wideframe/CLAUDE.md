# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-wideframe is a TypeScript connector for the [Wideframe API](https://wideframe.com/). It provides access to video libraries, footage indexing, semantic search, rough-cut sequences, and Adobe Premiere Pro exports.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
```

## API Reference

- **Base URL**: `https://api.wideframe.com/v1`
- **Auth**: Bearer token (`Authorization: Bearer <api_key>`)
- **Optional**: Override base URL via `WIDEFRAME_BASE_URL` or profile config

## API Operations

| Operation | Method | Path |
|-----------|--------|------|
| `listLibraries` | GET | `/libraries` |
| `getLibrary` | GET | `/libraries/{libraryId}` |
| `createIndexJob` | POST | `/libraries/{libraryId}/index-jobs` |
| `getIndexJob` | GET | `/index-jobs/{jobId}` |
| `searchFootage` | POST | `/libraries/{libraryId}/search` |
| `createSequence` | POST | `/sequences` |
| `exportPremiereProject` | POST | `/sequences/{sequenceId}/exports/premiere` |
| `rawRequest` | * | custom path |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|set-base-url\|show\|clear` | Manage configuration |
| `libraries list\|get` | List or get footage libraries |
| `index-jobs create\|get` | Create or get index jobs |
| `search <libraryId>` | Search indexed footage |
| `sequences create\|export-premiere` | Create sequences or export to Premiere |
| `raw-request` | Call any API path |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WIDEFRAME_API_KEY` | Wideframe API key (overrides profile) |
| `WIDEFRAME_BASE_URL` | Optional API base URL override |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
