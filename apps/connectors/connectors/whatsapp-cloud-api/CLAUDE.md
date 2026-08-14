# CLAUDE.md

## Project Overview

`connect-whatsapp-cloud-api` is a TypeScript connector for the third-party WhatsApp Cloud API at `https://api.whatsappcloudapi.com/v1`. It is **distinct** from `connect-whatsapp`, which targets Meta Graph API (`graph.facebook.com`).

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer API key (`api_key` auth type):

| Variable | Description |
|----------|-------------|
| `WHATSAPP_CLOUD_API_KEY` | API key (overrides profile) |
| `WHATSAPP_CLOUD_API_BASE_URL` | Optional base URL override |

Profile storage: `~/.hasna/connectors/connect-whatsapp-cloud-api/profiles/`

## API Endpoints

| Method | Path | Library | CLI |
|--------|------|---------|-----|
| GET | `/items` | `listItems()` | `items list` |
| POST | `/items` | `createItem(body)` | `items create` |
| GET | `/items/:itemId` | `getItem(id)` | `items get <id>` |
| GET | `/events` | `listEvents()` | `events list` |
| POST | `/search` | `search(body)` | `search` |
| * | custom | `rawRequest()` | `raw <path>` |

## Structure

```
src/
├── api/client.ts   # Bearer HTTP client
├── api/index.ts    # WhatsappCloudApi class
├── cli/index.ts    # Commander CLI
├── types/index.ts
└── utils/config.ts # Profiles + env config
```
