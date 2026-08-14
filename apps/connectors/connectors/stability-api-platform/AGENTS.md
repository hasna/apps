# AGENTS.md

Stability Api Platform connector for open-connectors.

## Auth

Bearer API key (`STABILITY_API_PLATFORM_API_KEY`). Dashboard auth type: apikey/bearer.

## Endpoints

Base URL: `https://api.stabilityapiplatform.com/v1`

Operations: list/create/get items, list events, search, raw request.

## Build

```bash
bun install && bun run typecheck && bun run build && bun test
```

No browser-use dependency. No internal references.
