# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-accurai is a TypeScript connector for the AccurAI API (by Aizenit). It provides a CLI and library for AI-powered document data extraction and processing.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.accurai.com/v1` (configurable via `ACCURAI_BASE_URL`)
- **Auth**: Bearer token: `Authorization: Bearer <API_KEY>`
- **Product**: Intelligent Document Processing (IDP) - OCR, data extraction, ML models

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Documents | `/documents` | Upload and manage documents for extraction |
| Predictions | `/predictions` | Data extraction results from documents |
| Models | `/models` | Available extraction models |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACCURAI_API_KEY` | API key (overrides profile config) |

## CLI Commands

```bash
connect-accurai documents list          # List documents
connect-accurai documents get <id>      # Get document by ID
connect-accurai documents upload        # Upload a document
connect-accurai documents delete <id>   # Delete a document
connect-accurai predictions list        # List predictions
connect-accurai predictions get <id>    # Get prediction by ID
connect-accurai predictions create      # Create a prediction
connect-accurai models list             # List available models
connect-accurai models get <id>         # Get model by ID
connect-accurai config set-key <key>    # Set API key
connect-accurai profile list            # List profiles
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
