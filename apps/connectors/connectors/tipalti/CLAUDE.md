# CLAUDE.md

Guidance for Claude Code when working with the Tipalti connector.

## Project Overview

`@hasna/connect-tipalti` is a TypeScript connector for the [Tipalti REST API](https://documentation.tipalti.com). It provides payee management, event listing, search, and raw request access with Bearer token authentication and multi-profile CLI configuration.

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `TIPALTI_API_KEY` or profile config (`connect-tipalti config set-key <key>`).

Default base URL: `https://api.tipalti.com/v1`

## API Surface

| Method | Endpoint | CLI |
|--------|----------|-----|
| GET | `/payees` | `payee list` |
| POST | `/payees` | `payee create` |
| GET | `/payees/{id}` | `payee get <id>` |
| GET | `/events` | `events list` |
| POST | `/search` | `search run` |
| * | arbitrary | `raw request --path <path>` |

## Configuration

Profiles: `~/.hasna/connectors/tipalti/profiles/`

| Variable | Description |
|----------|-------------|
| `TIPALTI_API_KEY` | API key (overrides profile) |
| `TIPALTI_BASE_URL` | Override base URL |

## Dependencies

commander, chalk only — no browser-use.
