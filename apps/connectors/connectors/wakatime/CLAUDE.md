# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-wakatime is a TypeScript connector for the WakaTime REST API v1. It provides multi-profile configuration, API key authentication, and CLI access to coding-time analytics endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

API key authentication. Credentials can be set via:
- Environment variable: `WAKATIME_API_KEY`
- Profile configuration: `wakatime config set-key <key>`

WakaTime accepts:
- Bearer tokens for keys prefixed with `waka_tok_`
- Basic auth with base64-encoded API keys for standard keys

## API Base URL

`https://wakatime.com/api/v1`

## Data Storage

```
~/.hasna/connectors/connect-wakatime/
├── current_profile
└── profiles/
    └── default.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
