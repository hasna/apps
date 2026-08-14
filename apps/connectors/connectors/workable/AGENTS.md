# AGENTS.md

Guidance for AI agents working with the Workable connector.

## Overview

`@hasna/connect-workable` wraps Workable SPI v3 REST (`https://{subdomain}.workable.com/spi/v3`) with Bearer token auth.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/workable.test.ts
```

## Structure

```
src/
├── api/       # HTTP client + resource modules
├── cli/       # Commander CLI (24 SPI operations)
├── types/     # ConnectorConfig, jobs, candidates, offers
└── utils/     # config (token + subdomain profiles), output
```

## Auth

- `WORKABLE_API_TOKEN` / profile `apiKey`
- `WORKABLE_SUBDOMAIN` / profile `subdomain` (required for every request)

## Security

- No hardcoded tokens
- `.env.example` uses placeholders only
- No `browser-use` dependency
