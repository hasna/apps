# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

UniProt protein and proteome search connector CLI — search proteins, get entries by accession, search proteomes.

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
│   ├── client.ts  # HTTP client (JSON)
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Notes

UniProt REST API is free — no API key or authentication required.
- Base URL: `https://rest.uniprot.org`
- Endpoints: `/uniprotkb/search`, `/uniprotkb/{accession}.json`, `/proteomes/search`
- Returns JSON
- Rate limit: Be respectful — avoid rapid repeated requests

## Authentication

None required. The UniProt API is free and open.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIPROT_DEFAULT_SIZE` | Default page size for search results (default: 25) |

## Data Storage

```
~/.hasna/connectors/connect-uniprot/
└── config.json    # User preferences (default size)
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
