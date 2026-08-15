# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-syntheticsciences is a TypeScript CLI and library for the Synthetic
Sciences co-scientist API. It wraps research projects, literature search,
experiments, GPU jobs, and drafts, with multi-profile support and a configurable
API base URL.

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

# Run tests
bun test
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
├── api/            # API client modules
│   ├── client.ts   # HTTP client (Bearer auth, retry/backoff, configurable base URL)
│   ├── research.ts # Projects, literature, experiments, GPU jobs, drafts
│   └── index.ts    # Main SyntheticSciences connector class + fromEnv
├── cli/
│   └── index.ts    # Commander-based CLI entry point
├── types/
│   └── index.ts    # Shared types
├── utils/
│   ├── config.ts   # Profile + credential management
│   └── output.ts   # Output formatting (json/table/pretty)
└── index.ts        # Public barrel export
```

## Authentication

Reads `SYNTHETICSCIENCES_API_KEY` (Bearer token) and optional
`SYNTHETICSCIENCES_BASE_URL` from the environment, or from the active profile
under `~/.hasna/connectors/connect-syntheticsciences/`.

## Notes

- No live network calls in tests — `globalThis.fetch` is stubbed.
- The API base URL is configurable; upstream defaults to
  `https://api.syntheticsciences.ai/v1`.
