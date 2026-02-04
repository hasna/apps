# GEMINI.md

This file provides guidance to Gemini when working with this repository.

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
~/.connect/connect-firecrawl/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
