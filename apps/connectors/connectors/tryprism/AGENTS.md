# AGENTS.md

Guidance for AI agents working with the TryPrism connector.

## Overview

`@hasna/connect-tryprism` is a Bearer-authenticated REST connector for TryPrism recruiting APIs.

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
├── api/client.ts      # HTTP client (Bearer auth)
├── api/index.ts       # TryPrism connector class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types and errors
└── utils/config.ts    # Profile + TRYPRISM_* env vars
```

## Authentication

Bearer Token via `TRYPRISM_API_KEY` or `connect-tryprism config set-key`.

## Security

- No hardcoded secrets
- `.env.example` uses placeholders only
- No browser-use dependency
