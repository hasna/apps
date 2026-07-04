# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-zipkin is a TypeScript connector for the Zipkin Cloud REST API (`https://api.zipkin.io/v1`). It provides multi-profile configuration, Bearer token authentication, and a CLI built with Commander.js.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `ZIPKIN_API_KEY`
- Profile configuration: `zipkin config set-key <key>`

The dashboard auth detector reads this file for bearer auth keywords.

## API Surface

Default base URL: `https://api.zipkin.io/v1`

| Operation | Method | Path |
|-----------|--------|------|
| List traces | GET | `/traces` |
| Get trace | GET | `/traces/{traceId}` |
| Create trace | POST | `/traces` |
| List events | GET | `/events` |
| Search | POST | `/search` |

Use `ZIPKIN_BASE_URL` to point at self-hosted Zipkin (`/api/v1` or `/api/v2`).

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── traces.ts
│   ├── events.ts
│   ├── search.ts
│   └── index.ts
├── cli/index.ts
├── types/index.ts
└── utils/{config,output}.ts
```

## Data Storage

```
~/.hasna/connectors/connect-zipkin/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "xxx",
  "baseUrl": "https://api.zipkin.io/v1"
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZIPKIN_API_KEY` | API key (overrides profile) |
| `ZIPKIN_BASE_URL` | Override API base URL |
