# connect-smartsheet

A TypeScript connector for the [Smartsheet REST API 2.0](https://smartsheet.redoc.ly/). Provides a CLI and library for managing sheets, rows, columns, folders, workspaces, reports, and webhooks.

## Features

- Bearer token authentication
- Multi-profile configuration
- Sheets, rows, columns, folders, workspaces, reports, webhooks
- TypeScript with strict mode
- CLI with JSON output support

## Quick Start

```bash
# Install dependencies
bun install

# Set access token
export SMARTSHEET_ACCESS_TOKEN=your-token-here
# Or use the CLI
bun run dev auth set your-token-here

# List sheets
bun run dev sheets list
```

## Authentication

Smartsheet uses Bearer token authentication. Generate an access token at [Smartsheet Admin → Personal Settings](https://app.smartsheet.com/admin/personal-settings).

Environment variable:
- `SMARTSHEET_ACCESS_TOKEN` - API access token

## CLI Commands

```bash
# Authentication
connect-smartsheet auth set <token>
connect-smartsheet auth status
connect-smartsheet auth clear

# Profiles
connect-smartsheet profile list|use|create|delete|show

# Sheets
connect-smartsheet sheets list|get|create|update|delete

# Rows
connect-smartsheet rows get|add|update|delete

# Columns
connect-smartsheet columns list|add|delete

# Folders
connect-smartsheet folders list|create

# Workspaces
connect-smartsheet workspaces list|create|delete

# Reports
connect-smartsheet reports list|get

# Webhooks
connect-smartsheet webhooks list|create
```

## Library Usage

```typescript
import { Smartsheet } from '@hasna/connect-smartsheet';

const client = Smartsheet.fromEnv();
const sheets = await client.listSheets();
```

## API Base URL

All requests go to `https://api.smartsheet.com/2.0`.

## License

Apache-2.0
