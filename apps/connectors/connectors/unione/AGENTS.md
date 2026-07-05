# AGENTS.md

Guidance for AI agents working with the UniOne connector.

## Overview

`@hasna/connect-unione` wraps the UniOne transactional email API (`https://api.unione.io/en/transactional/api/v1`). Authentication is API key via `X-API-KEY` header.

## Commands

```bash
bun install
bun run dev list-projects
bun run typecheck
bun test src/api/unione.test.ts
```

## Security

- Never commit real API keys
- `.env.example` contains placeholders only
- No internal references (beepmedia, hasnaxyz)

## Docs

https://docs.unione.io/en/web-api-ref
