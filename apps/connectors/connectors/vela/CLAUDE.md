# CLAUDE.md

This file provides guidance to Claude Code when working with the Vela connector.

## Project Overview

connect-vela is a TypeScript connector for the Vela AI scheduling API (`https://api.tryvela.ai/v1`). It provides CLI and library access for scheduling requests, meetings, contacts, and calendar sync.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/vela.test.ts
```

## Authentication

- **Type**: Bearer token (API key)
- **Header**: `Authorization: Bearer <api_key>`
- **Env vars**: `VELA_API_KEY`, optional `VELA_BASE_URL`
- **Storage**: `~/.hasna/connectors/connect-vela/profiles/`

Dashboard auth type: `apikey` / bearer.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scheduling-requests` | List scheduling requests |
| GET | `/scheduling-requests/:id` | Get scheduling request |
| POST | `/scheduling-requests` | Create scheduling request |
| GET | `/meetings` | List meetings |
| GET | `/meetings/:id` | Get meeting |
| POST | `/meetings/:id/cancel` | Cancel meeting |
| POST | `/meetings/:id/reschedule` | Reschedule meeting |
| GET | `/contacts` | List contacts |
| POST | `/calendar/sync` | Sync calendar |

## Project Structure

```
src/
├── api/
│   ├── client.ts              # HTTP client with Bearer auth
│   ├── scheduling-requests.ts
│   ├── meetings.ts
│   ├── contacts.ts
│   ├── calendar.ts
│   └── index.ts               # Vela class
├── cli/index.ts
├── types/index.ts
└── utils/config.ts
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VELA_API_KEY` | API key (overrides profile) |
| `VELA_BASE_URL` | Override base URL (default: https://api.tryvela.ai/v1) |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling

Public docs: https://tryvela.ai/
