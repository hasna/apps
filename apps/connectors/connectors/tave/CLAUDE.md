# connect-tave

Tave connector - studio-management CRM for photographers: contacts, jobs (shoots), leads, and orders.

## API Details

- **Base URL**: `https://tave.io/v2` (override with `TAVE_BASE_URL`)
- **Auth**: Bearer API key (`Authorization: Bearer <TAVE_API_KEY>`)
- **Response format**: JSON; list endpoints are read forgivingly (bare array or `{ data | results }` envelope)
- **Pagination**: `page`, `per_page`

> Tave's public API docs (`help.tave.com`) were retired after the VSCO acquisition. This connector targets the confirmed `https://tave.io/v2` Bearer surface and ships a `raw` escape hatch for endpoints without a dedicated wrapper.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TAVE_API_KEY` | API key used as the Bearer token |
| `TAVE_BASE_URL` | Optional base URL override (default `https://tave.io/v2`) |

## CLI Commands

```bash
connect-tave contacts list|get
connect-tave jobs list|get
connect-tave leads list|get|create
connect-tave orders list|get
connect-tave raw request <path> [-X METHOD] [-d JSON]
connect-tave profile list|use|create|delete|show
connect-tave config set-key|set-base-url|show|clear
```

## API Resources

- **Contacts** - list, get
- **Jobs** - list, get
- **Leads** - list, get, create
- **Orders** - list, get
- **Raw** - request/get/post any endpoint

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```
