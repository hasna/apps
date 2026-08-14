# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-split-in-batches is a TypeScript connector for the Split In Batches API. It provides a CLI and library for managing batch workflows, events, and search.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Details

- **Base URL**: `https://api.split-in-batches.com/v1` (override via profile or `SPLIT_IN_BATCHES_BASE_URL`)
- **Auth**: Bearer token via `Authorization: Bearer <API_KEY>`

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Batches | `GET/POST /batches`, `GET /batches/:id` | Batch workflow management |
| Events | `GET /events` | Batch-related events |
| Search | `POST /search` | Search batches and related data |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPLIT_IN_BATCHES_API_KEY` | API key (overrides profile config) |
| `SPLIT_IN_BATCHES_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-split-in-batches batches list
connect-split-in-batches batches get <batchId>
connect-split-in-batches batches create --name "My Batch"
connect-split-in-batches events list
connect-split-in-batches search --query "workflow"
connect-split-in-batches raw-request --path /batches
connect-split-in-batches config set-key <key>
connect-split-in-batches profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
