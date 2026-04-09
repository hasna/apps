# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Exa AI Search API connector CLI - Web search, content retrieval, similar pages, answers, research tasks, and websets

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

## API Updates (2025-2026)

### Company Search (Jan 2026)
New fine-tuned retrieval model with entity matching for company queries. Use `type="auto"` + `category="company"`.

```bash
curl -X POST https://api.exa.ai/search \
  -H "x-api-key: $EXA_API_KEY" \
  -d '{"query": "fintech companies in Switzerland", "type": "auto", "category": "company", "numResults": 10}'
```

Results now include **structured entity data** (`entities[]`) with:
- `name`, `foundedYear`, `description`, `workforce.total`
- `headquarters` (address, city, country)
- `financials` (fundingTotal, fundingLatestRound)
- `webTraffic.total`

Supports: semantic queries, composite queries, funding queries, attribute filtering, named lookups.

### Endpoints Overview (2026)
| Endpoint | Description |
|----------|-------------|
| `POST /search` | Neural/keyword search (`type`: auto, neural, keyword) |
| `POST /search` with `type=deep` | Multi-query deep search with structured answers |
| `POST /findSimilar` | Find pages similar to a given URL |
| `POST /contents` | Extract text, summaries, highlights from URLs |
| `POST /answer` | Direct answers with citations |
| `POST /research` | Async agent-style deep research |

### Search Types
- `neural` — semantic/embedding-based
- `keyword` — fast keyword matching
- `auto` — automatically selects best type
- `deep` — multi-query with structured answers (slower, better for complex queries)

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-exa config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXA_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-exa/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
