# connect-accelo

Accelo connector - professional services automation, projects, tickets, and CRM.

## API Details

- **Base URL**: `https://{deployment}.api.accelo.com/api/v0`
- **Auth**: OAuth2 Bearer token (`Authorization: Bearer <token>`)
- **Response format**: `{ meta: { status, message, more_info }, response: <data> }`
- **Pagination**: `_page` (0-indexed), `_limit`, `_offset`
- **Rate limit**: 5,000 requests/hour per deployment

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACCELO_ACCESS_TOKEN` | OAuth2 access token |
| `ACCELO_DEPLOYMENT` | Deployment name (subdomain) |
| `ACCELO_CLIENT_SECRET` | OAuth2 client secret |

## CLI Commands

```bash
connect-accelo companies list|get|create
connect-accelo contacts list|get|create
connect-accelo tasks list|get|create
connect-accelo issues list|get
connect-accelo jobs list|get
connect-accelo prospects list|get
connect-accelo staff list|me
connect-accelo activities list|get
connect-accelo profile list|use|create|delete|show
connect-accelo config set|get|clear|show
```

## API Resources

- **Companies** - list, get, create, update, count
- **Contacts** - list, get, create, update, count
- **Tasks** - list, get, create, update, count
- **Issues** - list, get, create, update, count
- **Jobs** - list, get, create, update, count
- **Prospects** - list, get, create, update, count
- **Staff** - list, get, me
- **Activities** - list, get, create

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```
