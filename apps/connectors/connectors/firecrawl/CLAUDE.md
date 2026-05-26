# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-firecrawl is a TypeScript connector for the Firecrawl web scraping API. It provides a CLI and programmatic interface to scrape, crawl, map, and search websites using Firecrawl's AI-powered extraction capabilities.

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

### Endpoints (v1)
| Endpoint | Description |
|----------|-------------|
| `POST /v1/scrape` | Scrape a single URL |
| `POST /v1/crawl` | Crawl a website |
| `POST /v1/map` | Map a website's URLs |
| `POST /v1/search` | Search the web and scrape results (Jun 2025) |
| `POST /v1/extract` | Extract structured data (v2: pagination, search, FIRE-1) |
| `POST /v1/agent` | Agentic data gathering (Dec 2025) |
| `POST /v1/batch/scrape` | Parallel agent batch processing |

### New in 2026
- **Browser Sandbox** (Feb 2026) — Fully managed isolated browser for agents. Zero config, pre-loaded tools.
- **PDF Parser v2** (Feb 2026) — 3x faster Rust-based parser. Three auto-adapting modes (clean text, scanned, complex).
- **Parallel Agents** (Jan 2026) — Batch `/agent` queries in spreadsheet/JSON format with streaming.
- **Branding Format v2** (Feb 2026) — Improved logo extraction for AI agents.
- **Spark 1 Pro/Mini models** (Jan 2026) — Flexible model selection for `/agent`. Mini is 60% cheaper.
- **Claude Code plugin** (Feb 2026) — Official Firecrawl skill for Claude Code.

### /extract v2 (Apr 2025)
Added: pagination, FIRE-1 intelligent interaction, built-in search integration.

### FIRE-1 Agent (Apr 2025)
New AI agent that intelligently navigates and interacts with web pages for complex scraping.

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-firecrawl config set-key <key>`


## API Modules

### Scrape API (`/scrape`)
- Scrape single URLs
- Extract content as markdown, HTML, links
- Capture screenshots (viewport or full page)
- AI-powered structured data extraction
- JavaScript actions (click, type, scroll, wait)

### Crawl API (`/crawl`)
- Asynchronous crawling jobs
- Start crawl, get status, cancel
- Configurable depth, limits, path filters
- Webhook support for completion

### Map API (`/map`)
- Discover all URLs on a website
- Search/filter URLs
- Sitemap-based or full crawl
- Subdomain support

### Search API (`/search`) - Beta
- Search the web with queries
- Scrape search results
- Language and country filters
- Time-based filtering

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FIRECRAWL_API_KEY` | API key (required) |
| `FIRECRAWL_BASE_URL` | Override base URL (default: https://api.firecrawl.dev/v1) |

## Data Storage

```
~/.hasna/connectors/connect-firecrawl/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
