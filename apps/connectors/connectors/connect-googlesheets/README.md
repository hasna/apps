# connect-googlesheets

Google Sheets API v4 connector - TypeScript client and CLI for reading/writing spreadsheets

## Installation

```bash
bun install -g @hasna/connect-googlesheets
```

## Quick Start

```bash
# Set your API key
connect-googlesheets config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-googlesheets profile create work --api-key xxx --use
connect-googlesheets profile create personal --api-key yyy

# Switch profiles
connect-googlesheets profile use work

# Use profile for single command
connect-googlesheets -p personal <command>

# List profiles
connect-googlesheets profile list
```

## Library Usage

```typescript
import { Googlesheets } from '@hasna/connect-googlesheets';

const client = new Googlesheets({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
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

Configuration stored in `~/.connect/connect-googlesheets/`:

```
~/.connect/connect-googlesheets/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
