# CLAUDE.md

## Project Overview

`@hasna/connect-voquill` is a TypeScript connector for the Voquill pathology report API (Bearer `api_key` auth).

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## API

- Base URL: `https://api.voquill.com/v1`
- Auth: `Authorization: Bearer <api_key>`
- Endpoints: `/cases`, `/reports`, `/templates`, `/snippets`, `/cpt-suggestions`

## Environment

| Variable | Description |
|----------|-------------|
| `VOQUILL_API_KEY` | API key |
| `VOQUILL_BASE_URL` | Optional base URL override |

Config stored at `~/.hasna/connectors/connect-voquill/`.
