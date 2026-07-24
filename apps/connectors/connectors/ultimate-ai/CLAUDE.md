# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-ultimate-ai is a TypeScript CLI and library for the Zendesk Ultimate AI support bot platform (`https://api.ultimate.ai/v1`). Do not confuse with `api.ultimateai.org`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

**Bearer Token** via `ULTIMATE_AI_API_KEY` or profile config (`connect-ultimate-ai config set-key <key>`).

## CLI Commands

```bash
connect-ultimate-ai bots list
connect-ultimate-ai bots get <botId>
connect-ultimate-ai bots create --name "My Bot"
connect-ultimate-ai events list
connect-ultimate-ai search --query "refund policy"
connect-ultimate-ai raw GET /bots
connect-ultimate-ai config set-key <key>
connect-ultimate-ai profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ULTIMATE_AI_API_KEY` | API key (Bearer token) |
| `ULTIMATE_AI_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-ultimate-ai/
├── current_profile
└── profiles/
    └── default.json
```
