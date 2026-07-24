# CLAUDE.md

This file provides guidance to Claude Code when working with the Zolvo connector.

## Project Overview

`@hasna/connect-zolvo` is a TypeScript connector for the Zolvo commercial lending servicing API. It uses Bearer token (API key) authentication against `https://api.zolvo.com/v1`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

- **Type**: API key (Bearer token)
- **Header**: `Authorization: Bearer <api_key>`
- **Config**: `ZOLVO_API_KEY` env var or `connect-zolvo config set-key`
- **Profiles**: `~/.hasna/connectors/connect-zolvo/profiles/`

## API Operations

| Operation | Method | Path |
|-----------|--------|------|
| List loans | GET | `/loans` |
| Get loan | GET | `/loans/{loanId}` |
| List payments | GET | `/payments` |
| Reconcile payment | POST | `/payments/{paymentId}/reconcile` |
| Create servicing task | POST | `/loans/{loanId}/tasks` |
| Raw request | * | custom path |

Path segments (loan/payment IDs) are URL-encoded via `encodeURIComponent`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOLVO_API_KEY` | API key (overrides profile) |
| `ZOLVO_BASE_URL` | Override base URL (default `https://api.zolvo.com/v1`) |

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with Bearer auth
│   ├── loans.ts       # Loan endpoints
│   ├── payments.ts    # Payment endpoints
│   ├── servicing.ts   # Servicing task endpoints
│   └── index.ts       # Zolvo facade class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Types and ZolvoApiError
└── utils/
    ├── config.ts      # Multi-profile config
    └── output.ts      # CLI output formatting
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
