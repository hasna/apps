# CLAUDE.md

Guidance for Claude Code when working with connect-time-saved.

## Project Overview

connect-time-saved is a TypeScript connector for the TimeSaved time analytics platform API (`https://api.time-saved.com/v1`).

## Build & Run

```bash
bun install
bun run dev reports list
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Credentials can be set via:
- Environment variable `TIMESAVED_API_KEY` (or `TIMESAVED_TOKEN`)
- Profile configuration: `connect-time-saved config set-key <key>`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports` | List reports |
| POST | `/reports` | Create report |
| GET | `/reports/:reportId` | Get report |
| GET | `/events` | List events |
| POST | `/search` | Search analytics data |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIMESAVED_API_KEY` | API key |
| `TIMESAVED_TOKEN` | Alias for API key |
| `TIMESAVED_BASE_URL` | Optional base URL override |

## Data Storage

```
~/.hasna/connectors/connect-time-saved/
├── current_profile
└── profiles/
    └── default.json
```
