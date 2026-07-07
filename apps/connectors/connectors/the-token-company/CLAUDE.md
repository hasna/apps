# CLAUDE.md

The Token Company API connector for LLM prompt compression.

## Authentication

- **Type:** `api_key` (Bearer token)
- **Required:** `api_key`
- **Optional:** `base_url` (default `https://api.thetokencompany.com/v1`)

## Environment Variables

- `THE_TOKEN_COMPANY_API_KEY` — API key (required)
- `THE_TOKEN_COMPANY_BASE_URL` — Override API base URL

## API

- `POST /compress` — Compress LLM input text
  - Models: `bear-2` (recommended), `bear-1.2`
  - `compression_settings.aggressiveness`: 0.05–0.9

## Development

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Docs

https://thetokencompany.com/docs
