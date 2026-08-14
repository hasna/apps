# CLAUDE.md

Zoho Meeting connector for REST API v2 (`https://meeting.zoho.{dc}/api/v2`).

## Auth

OAuth access token via `Zoho-oauthtoken` header. Configure with:

- `ZOHO_MEETING_TOKEN` environment variable
- `connect-zoho-meeting config set --token <token>`
- Profile JSON under `~/.hasna/connectors/zoho-meeting/profiles/`

Data centers: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`. Override with `ZOHO_MEETING_DATA_CENTER` or `--data-center`.

## Commands

```bash
bun install
bun run dev sessions list
bun run typecheck
bun test
```

## API modules

- `sessions` — list/get/create/update/delete/start/end
- `participants` — list/add/remove
- `webinars` — CRUD, registrants, polls
- `recordings` — list/get/delete
- `reports` — session and webinar reports

## Environment

| Variable | Description |
|----------|-------------|
| `ZOHO_MEETING_TOKEN` | OAuth access token |
| `ZOHO_MEETING_DATA_CENTER` | Zoho data center (default `com`) |
| `ZOHO_MEETING_BASE_URL` | Optional full API base URL override |
