# CLAUDE.md

Guidance for working with the Wappalyzer connector.

## Overview

Wappalyzer connector — TypeScript CLI and library for the Wappalyzer API v2 (technology lookup, credits).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Details

- **Base URL**: `https://api.wappalyzer.com/v2`
- **Auth**: API key via `x-api-key` header
- **Rate limit**: 10 requests/second (up to 10 URLs per lookup request)

### Endpoints

- `GET /lookup/` — Technology lookup (`urls`, `live`, `recursive`, `sets`, `callback_url`, etc.)
- `GET /credits/balance/` — Remaining API credits

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WAPPALYZER_API_KEY` | API key (overrides profile) |
| `WAPPALYZER_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-wappalyzer lookup <urls...> [--live] [--recursive] [--sets ...] [--callback-url ...]
connect-wappalyzer credits balance
connect-wappalyzer config set-key <key>
connect-wappalyzer config show
connect-wappalyzer profile list|use|create|delete|show
```

## Auth Type

apikey — store key in `~/.hasna/connectors/connect-wappalyzer/profiles/`.
