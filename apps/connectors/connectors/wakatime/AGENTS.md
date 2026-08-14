# AGENTS.md

Guidance for AI agents working with connect-wakatime.

## Overview

TypeScript connector for the WakaTime REST API with multi-profile API key auth and Commander CLI.

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test src/api/client.test.ts
```

## Structure

```
src/
├── api/       # HTTP client and endpoint modules
├── cli/       # Commander CLI
├── types/     # Shared types
└── utils/     # config + output helpers
```

## Authentication

API key via `WAKATIME_API_KEY` or `wakatime config set-key`.

Profiles live under `~/.hasna/connectors/connect-wakatime/`.
