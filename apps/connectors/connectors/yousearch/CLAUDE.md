# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-yousearch is a TypeScript CLI and library for You.com's Search and Research APIs. It provides web/news search and multi-step research with citations.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key authentication via `X-API-Key` header.

- Environment: `YOUSEARCH_API_KEY`
- Profile: `connect-yousearch config set-key <key>`
- Optional base URL: `YOUSEARCH_BASE_URL` or `config set-base-url`

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with X-API-Key auth
│   ├── search.ts     # GET/POST /v1/search
│   ├── research.ts   # POST /v1/research
│   └── index.ts      # Main YouSearch class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # API types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## CLI Commands

```bash
connect-yousearch search <query> [--count N]
connect-yousearch search-post <query> [--include-domains a,b]
connect-yousearch research <input> [--effort standard|deep]
connect-yousearch raw-request <path> [-X METHOD] [-d JSON]
connect-yousearch config set-key|set-base-url|show
connect-yousearch profile list|use|create|delete|show
```

## Data Storage

```
~/.hasna/connectors/connect-yousearch/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
