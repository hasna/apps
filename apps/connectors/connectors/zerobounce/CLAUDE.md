# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-zerobounce is a TypeScript connector for the [ZeroBounce](https://www.zerobounce.net/) email validation API. It provides single and batch email validation, bulk file processing, AI scoring, and enrichment endpoints.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## Authentication

ZeroBounce uses `api_key` authentication:

- **GET endpoints** (`api.zerobounce.net`): `api_key` is passed as a query parameter
- **POST JSON endpoints** (`api.zerobounce.net/v2/validatebatch`): `api_key` is included in the JSON body
- **Bulk file endpoints** (`bulkapi.zerobounce.net`): `api_key` is a form field (multipart) or query parameter (GET)

## API Hosts

- `https://api.zerobounce.net` — real-time validation, account, enrichment, scoring (single)
- `https://bulkapi.zerobounce.net` — bulk file upload/status/download

## Project Structure

```
src/
├── api/
│   ├── client.ts       # Dual-host HTTP client
│   ├── validation.ts   # validate, validateSandbox, validateBatch
│   ├── account.ts      # getCredits, getApiUsage
│   ├── bulk.ts         # sendFile, getFileStatus, getFile, deleteFile
│   ├── scoring.ts      # AI scoring file + single score
│   ├── enrichment.ts   # guessFormat, domainSearch, getActivity
│   └── index.ts        # Connector facade
├── cli/index.ts
├── types/index.ts
└── utils/
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZERO_BOUNCE_API_KEY` | ZeroBounce API key (overrides profile) |

## CLI Commands

```bash
connect-zerobounce validate email <email> [--ip <ip>]
connect-zerobounce validate sandbox <email>
connect-zerobounce validate batch --emails "a@b.com,c@d.com"
connect-zerobounce account credits
connect-zerobounce account usage --start 2026-01-01 --end 2026-01-31
connect-zerobounce bulk send <file> --email-column 1
connect-zerobounce bulk status <fileId>
connect-zerobounce scoring score <email>
connect-zerobounce enrich guess-format <email>
connect-zerobounce enrich domain-search <domain>
connect-zerobounce enrich activity <email>
connect-zerobounce config set-key <key>
```
