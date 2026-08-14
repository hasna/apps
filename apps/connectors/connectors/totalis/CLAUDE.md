# CLAUDE.md

Guidance for Claude Code when working with the Totalis connector.

## Project Overview

`connect-totalis` is a TypeScript CLI and SDK for the Totalis REST API (prediction market parlays, quote requests, wallet).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

auth: apikey

Programmatic clients send `X-API-Key`. Configure via `TOTALIS_API_KEY` or `connect-totalis config set-key <key>`.

Profiles live at `~/.hasna/connectors/connect-totalis/profiles/`.

## API Base URL

`https://api.totalis.trade`

## Structure

```
src/
├── api/
│   ├── client.ts
│   ├── markets.ts
│   ├── parlays.ts
│   ├── quote-requests.ts
│   └── wallet.ts
├── cli/index.ts
├── types/index.ts
└── utils/{config,output}.ts
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOTALIS_API_KEY` | API key (overrides profile) |
| `TOTALIS_BASE_URL` | Optional API base URL override |

## Docs

https://docs.totalis.trade
