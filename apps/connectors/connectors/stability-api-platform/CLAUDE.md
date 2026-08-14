# CLAUDE.md

Stability Api Platform connector — Bearer token REST client for `https://api.stabilityapiplatform.com/v1`.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `STABILITY_API_PLATFORM_API_KEY` or `connect-stability-api-platform config set-key <key>`.

Optional `STABILITY_API_PLATFORM_BASE_URL` / `config set-base-url` for API base URL override.

## API surface

- `items list` — GET `/items`
- `items create` — POST `/items`
- `items get <itemId>` — GET `/items/:itemId`
- `events list` — GET `/events`
- `search` — POST `/search`
- `raw` — configurable method/path/query

## Storage

`~/.hasna/connectors/connect-stability-api-platform/profiles/`
