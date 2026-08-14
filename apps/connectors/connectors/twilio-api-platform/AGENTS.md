# AGENTS.md

Guidance for AI agents working with `connect-twilio-api-platform`.

## Overview

Bearer-authenticated REST connector for `https://api.twilioapiplatform.com/v1`. Not the same as `connect-twilio` (`api.twilio.com`).

## Auth

Bearer Token via `TWILIO_API_PLATFORM_API_KEY` or `connect-twilio-api-platform config set-key`.

## Key files

- `src/api/client.ts` — HTTP transport + Bearer auth
- `src/api/index.ts` — `TwilioApiPlatform` facade (items, events, search, raw)
- `src/cli/index.ts` — Commander CLI
- `src/utils/config.ts` — profiles under `~/.hasna/connectors/connect-twilio-api-platform/`

## Tests

```bash
cd connectors/twilio-api-platform && bun test
```

Mock `fetch` only; never commit real API keys.
