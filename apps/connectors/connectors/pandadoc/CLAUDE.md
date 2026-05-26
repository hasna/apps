# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

PandaDoc API connector - A TypeScript CLI for the PandaDoc API with multi-profile support

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

## API Updates (2025)

### New API Capabilities (Jun 2025)
- **Update documents with images** via API
- **Create templates from URLs** (no manual upload)
- **SMS consent tracking** via API
- **Editing session tokens** without adding users
- **Programmatic API key creation** for workspace setup automation

### Document Settings Changes (v7.14.0)
- `expires_in` property added to `GET/PATCH /documents/{id}/settings` responses
- `qualified_electronic_signature` removed from template settings

### Integrations (Jun 2025)
- PandaDoc CPQ for Pipedrive (two-way sync)
- QuickBooks Online integration (estimates + invoices)
- Recurring payments via Stripe from documents

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-pandadoc config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `PANDADOC_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-pandadoc/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
