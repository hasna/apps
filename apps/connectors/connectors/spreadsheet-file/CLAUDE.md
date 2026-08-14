# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-spreadsheet-file is a TypeScript connector for the SpreadsheetFile API. It provides a CLI and library for managing spreadsheet workflow files, events, and search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check

# Example commands
bun run dev files list
bun run dev files get <fileId>
bun run dev files create --body '{"name":"example"}'
bun run dev events list
bun run dev search --body '{"query":"example"}'
bun run dev config show
```

## API Authentication

SpreadsheetFile uses **Bearer token** authentication with an `api_key` credential.

Environment variables:
- `SPREADSHEET_FILE_API_KEY` - API key (Bearer token)
- `SPREADSHEET_FILE_BASE_URL` - Optional API base URL override

## API Details

- **Base URL**: `https://api.spreadsheet-file.com/v1`
- **Auth**: `Authorization: Bearer <api_key>`
- **Endpoints**:
  - `GET /files` - List files
  - `POST /files` - Create file
  - `GET /files/{fileId}` - Get file
  - `GET /events` - List events
  - `POST /search` - Search

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth, retry, timeout
│   ├── files.ts      # Files API
│   ├── events.ts     # Events API
│   ├── search.ts     # Search API
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
~/.hasna/connectors/connect-spreadsheet-file/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:
```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.spreadsheet-file.com/v1"
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
