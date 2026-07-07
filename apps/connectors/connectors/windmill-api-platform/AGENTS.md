# AGENTS.md

Guidance for AI agents working with the Windmill API Platform connector.

## Overview

REST API connector for workspace-scoped Windmill APIs. Bearer token auth. No browser-use dependency.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Structure

```
src/
├── api/client.ts      # HTTP client
├── api/index.ts       # WindmillApiPlatform facade
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types
└── utils/config.ts    # Multi-profile config
```

## Auth

- Bearer token: `WINDMILL_API_PLATFORM_API_KEY`
- Required API base URL: `WINDMILL_API_PLATFORM_BASE_URL`
- Required workspace id: `WINDMILL_API_PLATFORM_WORKSPACE`
- Config dir: `~/.hasna/connectors/connect-windmill-api-platform/`

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
