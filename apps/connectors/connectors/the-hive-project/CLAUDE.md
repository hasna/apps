# CLAUDE.md

## Project Overview

`connect-the-hive-project` is a TypeScript connector for real **TheHive** instance APIs documented by StrangeBee.

This connector deliberately uses the distinct slug `the-hive-project`. The repository already contains `thehive` and `thehive5` scaffold packages; this package is the concrete TheHive 5 API connector and should not be merged into those scaffold entries in this PR.

## API Details

- **Base URL**: root URL of a real TheHive instance, for example `https://thehive.example`
- **API Prefix**: connector appends `/api/v1`
- **Auth**: Bearer token — `Authorization: Bearer <API_KEY>`
- **Organisation**: optional `X-Organisation` header via `THE_HIVE_PROJECT_ORGANISATION`
- **Docs**: `https://docs.strangebee.com/thehive/api-docs/`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/query` | Run queries, including case listing |
| POST | `/api/v1/case` | Create a case |
| GET | `/api/v1/case/{idOrName}` | Get case by ID or name |
| POST | `/api/v1/case/{caseId}/customEvent` | Create a custom timeline event |
| PATCH | `/api/v1/customEvent/{eventId}` | Update a custom timeline event |
| DELETE | `/api/v1/customEvent/{eventId}` | Delete a custom timeline event |

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
connect-the-hive-project query run --body '{"query":[{"_name":"listCase"}]}'
connect-the-hive-project events create <caseId> --body '{"title":"Timeline note"}'
connect-the-hive-project raw-request --path /status --method GET
connect-the-hive-project config set-key <key>
connect-the-hive-project config set-base-url https://thehive.example
connect-the-hive-project profile list
```

## Configuration

Profiles stored in `~/.hasna/connectors/the-hive-project/profiles/`.
