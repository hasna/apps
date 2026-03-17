# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-airtable is a TypeScript connector for the Airtable API. It provides a CLI and library for managing bases, tables, records, fields, comments, and webhooks.

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

# Run specific commands
bun run dev auth status
bun run dev bases list
bun run dev records list <base-id> <table>
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer token auth
│   └── index.ts      # Airtable API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   └── config.ts     # Multi-profile configuration
└── index.ts          # Library exports
```

## API Authentication

Airtable uses OAuth 2.0 Bearer token authentication (personal access tokens or API keys).

Environment variables:
- `AIRTABLE_ACCESS_TOKEN` - Personal access token (primary)
- `AIRTABLE_API_KEY` - Legacy API key (fallback)

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-airtable/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### API Base URL

All requests go to `https://api.airtable.com/v0`:
- `/meta/bases` - List bases
- `/meta/bases/{baseId}/tables` - Get base schema
- `/{baseId}/{tableIdOrName}` - Record operations

### Field Types

Supported field types:
- Text: singleLineText, multilineText, richText, email, url, phoneNumber
- Number: number, percent, currency, rating, duration
- Select: singleSelect, multipleSelects
- Date/Time: date, dateTime, createdTime, lastModifiedTime
- Lookup: multipleRecordLinks, lookup, rollup, count
- Other: checkbox, multipleAttachments, barcode, autoNumber, formula

## CLI Commands

- `auth set/status/clear` - Authentication
- `profile list/use/create/delete/show` - Profile management
- `bases list/schema` - Base operations
- `tables create/update` - Table operations
- `records list/get/create/update/delete` - Record operations
- `fields create/update` - Field operations
- `comments list/create/delete` - Comment operations
- `webhooks list/delete/refresh` - Webhook operations

## Data Storage

```
~/.connect/connect-airtable/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "accessToken": "pat..."
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
