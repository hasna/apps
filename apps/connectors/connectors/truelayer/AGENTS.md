# AGENTS.md

Guidance for AI agents working with the TrueLayer connector.

## Overview

`@hasna/connect-truelayer` is a TypeScript API connector for TrueLayer open banking (payments, events, search).

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Authentication

Bearer token via `TRUELAYER_ACCESS_TOKEN` or `connect-truelayer config set-token`.

## Structure

```
connectors/truelayer/
├── src/api/       # API client modules
├── src/cli/       # CLI entry point
├── src/types/     # TypeScript types
└── src/utils/     # Config and output helpers
```

## Security

- No hardcoded API keys
- `.env.example` has placeholders only
- Uses `@hasna` namespace
