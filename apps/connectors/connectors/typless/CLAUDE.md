# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-typless is a TypeScript connector for the Typless API. It provides a CLI and library for AI-powered document data extraction, OCR, and model training.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://developers.typless.com/api` (configurable via `TYPLESS_BASE_URL`)
- **Auth**: Token API key: `Authorization: Token <API_KEY>`
- **Docs**: https://typless.gitbook.io/typlessapi

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Extraction | `/extract-data`, `/extract-data-async`, `/get-extraction-data`, `/api/v1/awaiting-poll` | Sync and async document data extraction |
| Training | `/api/v1/add-document`, `/api/v1/add-document-feedback`, `/api/v1/start-training` | Dataset building and model training |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPLESS_API_KEY` | API key (overrides profile config) |
| `TYPLESS_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-typless extraction extract --file invoice.pdf --document-type my-invoice
connect-typless extraction extract-async --file invoice.pdf --document-type my-invoice --wait
connect-typless extraction get <extraction-id>
connect-typless extraction awaiting-poll
connect-typless training add-document --file doc.pdf --document-type my-type
connect-typless training add-feedback --object-id <id>
connect-typless training start --document-type my-type
connect-typless raw request --path /extract-data --method POST --body '{}'
connect-typless config set-key <key>
connect-typless profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime

## Auth

auth: apikey
api_key field
