# CLAUDE.md

This file provides guidance to Claude Code when working with the TryPrism connector.

## Project Overview

connect-tryprism is a TypeScript CLI and library for the TryPrism API (AI-native recruiting). It provides multi-profile configuration, Bearer token authentication, and Commander.js CLI commands for searches, candidates, and shortlists.

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

- Environment variable: `TRYPRISM_API_KEY`
- Profile configuration: `connect-tryprism config set-key <key>`

Optional base URL override via `TRYPRISM_BASE_URL` or `connect-tryprism config set-base-url <url>` (default: `https://api.tryprism.com/v1`).

## API Surface

| Resource | Methods |
|----------|---------|
| Searches | list, get, create |
| Candidates | list, get, submit feedback |
| Shortlists | list, get |
| Escape hatch | `raw` command for undocumented paths |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRYPRISM_API_KEY` | API key (overrides profile) |
| `TRYPRISM_BASE_URL` | Override base URL |

## Data Storage

```
~/.hasna/connectors/connect-tryprism/
├── current_profile
└── profiles/
    └── default.json
```
