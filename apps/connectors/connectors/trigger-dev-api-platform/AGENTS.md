# AGENTS.md

Guidance for AI agents working with connect-trigger-dev-api-platform.

## Overview

Thin REST client for Trigger.dev management API at `https://api.trigger.dev`. No browser automation, no `@trigger.dev/sdk` runtime dependency.

## Security

- Never commit real API keys
- `.env.example` contains placeholders only
- Profiles stored under `~/.hasna/connectors/connect-trigger-dev-api-platform/`

## Key Files

- `src/api/client.ts` — HTTP transport, Bearer auth, retry on 429/5xx
- `src/api/index.ts` — `TriggerDevApiPlatform` facade
- `src/cli/index.ts` — Commander CLI
- `src/utils/config.ts` — Multi-profile config

## Tests

```bash
bun test src/api/client.test.ts
```
