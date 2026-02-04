# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-googlesheets is a TypeScript connector for the Google Sheets API v4. It provides a programmatic client and CLI for reading/writing spreadsheets with support for both API key authentication (read-only) and OAuth authentication (full access).

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-googlesheets config set-key <key>`
- OAuth flow: `connect-googlesheets oauth login`

## API Modules

### Spreadsheets API

- `spreadsheets.get(spreadsheetId)` - Get spreadsheet metadata
- `spreadsheets.create(title)` - Create new spreadsheet
- `spreadsheets.batchUpdate(spreadsheetId, requests)` - Batch update operations
- `spreadsheets.rename(spreadsheetId, newTitle)` - Rename spreadsheet

### Values API

- `values.get(spreadsheetId, range)` - Read cell values
- `values.update(spreadsheetId, range, values)` - Write cell values
- `values.append(spreadsheetId, range, values)` - Append rows
- `values.clear(spreadsheetId, range)` - Clear cells
- `values.batchGet(spreadsheetId, ranges)` - Read multiple ranges
- `values.batchUpdate(spreadsheetId, data)` - Write multiple ranges

### Sheets API

- `sheets.add(spreadsheetId, title)` - Add new sheet
- `sheets.delete(spreadsheetId, sheetId)` - Delete sheet
- `sheets.rename(spreadsheetId, sheetId, newTitle)` - Rename sheet
- `sheets.copy(spreadsheetId, sheetId, destSpreadsheetId)` - Copy sheet
- `sheets.duplicate(spreadsheetId, sheetId)` - Duplicate within spreadsheet
- `sheets.hide(spreadsheetId, sheetId)` - Hide sheet
- `sheets.show(spreadsheetId, sheetId)` - Show hidden sheet
- `sheets.freeze(spreadsheetId, sheetId, { rows, columns })` - Freeze rows/columns

## CLI Commands

```bash
# Read values
connect-googlesheets get <spreadsheetId> "Sheet1!A1:B10"
connect-googlesheets get <spreadsheetId> "Sheet1!A1:B10" --raw
connect-googlesheets get <spreadsheetId> "Sheet1!A1:B10" --formulas

# Write values (requires OAuth)
connect-googlesheets set <spreadsheetId> "Sheet1!A1" '["Hello", "World"]'
connect-googlesheets set <spreadsheetId> "Sheet1!A1:B2" '[["A","B"],["C","D"]]'

# Append rows (requires OAuth)
connect-googlesheets append <spreadsheetId> "Sheet1!A:B" '["New", "Row"]'

# Create spreadsheet (requires OAuth)
connect-googlesheets create "My Spreadsheet"
connect-googlesheets create "My Spreadsheet" --locale en_US --timezone America/New_York

# List sheets
connect-googlesheets list-sheets <spreadsheetId>

# Get spreadsheet info
connect-googlesheets info <spreadsheetId>

# Clear range (requires OAuth)
connect-googlesheets clear <spreadsheetId> "Sheet1!A1:B10"

# Sheet management (requires OAuth)
connect-googlesheets sheet add <spreadsheetId> "New Sheet"
connect-googlesheets sheet delete <spreadsheetId> <sheetId>
connect-googlesheets sheet rename <spreadsheetId> <sheetId> "New Name"
connect-googlesheets sheet copy <spreadsheetId> <sheetId> <destSpreadsheetId>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | API key for read-only access |
| `GOOGLE_ACCESS_TOKEN` | OAuth access token |
| `GOOGLE_REFRESH_TOKEN` | OAuth refresh token |
| `GOOGLE_CLIENT_ID` | OAuth client ID (for token refresh) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (for token refresh) |

## Data Storage

```
~/.connect/connect-googlesheets/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
