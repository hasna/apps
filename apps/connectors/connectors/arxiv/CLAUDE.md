# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

arXiv research paper search and retrieval connector CLI - Search papers, get metadata, list recent papers, search by author, download PDFs

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
│   ├── client.ts  # HTTP client (XML parsing)
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

arXiv API is free — no API key or authentication required.
- Base URL: `http://export.arxiv.org/api/query`
- Returns Atom XML (parsed internally)
- Rate limit: Be respectful — no more than 1 request per 3 seconds recommended
- Categories: cs.AI, cs.LG, cs.CL, math.CO, physics.hep-th, etc.

## Authentication

None required. The arXiv API is free and open.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ARXIV_CATEGORY` | Default category filter |
| `ARXIV_MAX_RESULTS` | Default max results (default: 10) |
| `ARXIV_OUTPUT_DIR` | Default PDF download directory |

## Data Storage

```
~/.hasna/connectors/connect-arxiv/
└── config.json    # User preferences (category, max results, output dir)
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
