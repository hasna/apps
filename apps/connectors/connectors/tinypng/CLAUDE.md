# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-tinypng is a TypeScript connector for the TinyPNG (Tinify) API. It provides multi-profile configuration, API key authentication via HTTP Basic Auth, and CLI commands for URL-based image compression.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Notes

- Base URL: `https://api.tinify.com`
- Auth: HTTP Basic with username `api` and password set to your API key
- Primary endpoint: `POST /shrink` with JSON body `{ source: { url } }`
- Optional `preserve: ["copyright"]` and `store: { service: "s3" | "gcs" }`

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable: `TINYPNG_API_KEY`
- Profile configuration: `tinypng config set-key <key>`

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── index.ts
│   └── client.test.ts
├── cli/
│   └── index.ts
├── types/
│   └── index.ts
├── utils/
│   ├── config.ts
│   └── output.ts
└── index.ts
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINYPNG_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-tinypng/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
