# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-uspto is a TypeScript connector for USPTO (United States Patent and Trademark Office) APIs with browser automation support via Playwright. It provides both API integration and browser automation for features not available through APIs.

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

## API Notes (2026)

USPTO (US Patent and Trademark Office) open data APIs — mostly free/no auth required.
- Patent Center API: `https://patentcenter.uspto.gov/retrieval/public/v1/`
- Patent Search API (PatentsView): `https://search.patentsview.org/api/v1/`
- Trademark API: `https://tsdrapi.uspto.gov/ts/cd/casestatus/`
Auth: Optional API key for higher rate limits.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-uspto config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `USPTO_API_KEY` | API key (optional for most APIs) |
| `USPTO_TOKEN` | Alternative API key variable |
| `USPTO_HEADLESS` | Run browser in headless mode (default: true) |
| `USPTO_BROWSER` | Browser to use: chromium, firefox, webkit |
| `USPTO_OUTPUT_DIR` | Output directory for downloads |

## Data Storage

```
~/.connectors/connect-uspto/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
