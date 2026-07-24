# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-testerarmy is a TypeScript connector for the TesterArmy API. It provides multi-profile configuration, API key authentication (Bearer header), and a CLI for QA projects, tests, groups, runs, and webhooks.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `testerarmy config set-key <key>`
- Optional custom base URL: `testerarmy config set-base-url <url>`

Webhook trigger commands do not send the API key unless custom headers are provided.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTERARMY_API_KEY` | API key (overrides profile) |
| `TESTERARMY_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/testerarmy/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## CLI Commands

```bash
testerarmy profile list
testerarmy config set-key <key>
testerarmy projects list
testerarmy tests list
testerarmy groups list
testerarmy runs list
testerarmy webhooks trigger-project <webhookId> <secret>
testerarmy raw-request --path /v1/projects
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
