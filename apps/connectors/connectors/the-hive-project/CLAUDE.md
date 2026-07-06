# CLAUDE.md

## Project Overview

`connect-the-hive-project` is a TypeScript connector for the **TheHiveProject** REST API — a security case management platform.

## API Details

- **Base URL**: `https://api.thehive-project.com/v1`
- **Auth**: Bearer token — `Authorization: Bearer <API_KEY>`
- **Docs**: Public API at `api.thehive-project.com`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cases` | List cases |
| POST | `/cases` | Create a case |
| GET | `/cases/{id}` | Get case by ID |
| GET | `/events` | List events |
| POST | `/search` | Search cases and related entities |

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THE_HIVE_PROJECT_API_KEY` | Bearer API key |
| `THE_HIVE_PROJECT_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-the-hive-project cases list
connect-the-hive-project cases get <caseId>
connect-the-hive-project cases create --title "Incident" --description "Details"
connect-the-hive-project events list
connect-the-hive-project search run --body '{"query":{}}'
connect-the-hive-project raw-request --path /cases --method GET
connect-the-hive-project config set-key <key>
connect-the-hive-project profile list
```

## Configuration

Profiles stored in `~/.hasna/connectors/the-hive-project/profiles/`.
