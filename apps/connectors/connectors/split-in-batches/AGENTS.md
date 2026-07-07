# AGENTS.md

Guidance for AI agents working with the Split In Batches connector.

## Overview

`@hasna/connect-split-in-batches` is a TypeScript API connector with CLI and library entry points for the Split In Batches REST API.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
src/
├── api/           # HTTP client and resource modules
├── cli/           # Commander CLI
├── types/         # Shared types
└── utils/         # Config and output helpers
```

## Authentication

Bearer API key via `SPLIT_IN_BATCHES_API_KEY` or profile config at `~/.hasna/connectors/connect-split-in-batches/`.

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- Tests mock `fetch`; no live API calls in CI
