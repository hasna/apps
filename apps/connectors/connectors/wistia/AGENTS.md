# AGENTS.md

Guidance for AI agents working with the Wistia connector.

## Overview

`@hasna/connect-wistia` wraps the Wistia Data API (`https://api.wistia.com/v1/*`) with Bearer token auth.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

- Type: Bearer / API key
- Env: `WISTIA_API_TOKEN` or `WISTIA_API_KEY`
- CLI: `connect-wistia config set-key <token>`
- No OAuth, no browser-use

## Structure

```
src/
├── api/       # client + resource modules
├── cli/       # Commander CLI
├── types/     # TypeScript types
└── utils/     # config + output
```

## Security

- No hardcoded tokens
- `.env.example` uses placeholders only
- `@hasna` namespace
