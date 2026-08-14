# connect-workable

Workable connector — recruiting and applicant tracking via SPI v3 REST API.

## API Details

- **Base URL**: `https://{subdomain}.workable.com/spi/v3`
- **Auth**: Bearer token (`Authorization: Bearer <api_token>`)
- **Docs**: https://workable.readme.io/

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORKABLE_API_TOKEN` | API access token from Workable settings |
| `WORKABLE_SUBDOMAIN` | Account subdomain (e.g. `acme` for `acme.workable.com`) |

## CLI Commands

```bash
connect-workable jobs list|get|create
connect-workable candidates list|create|get|update|move|copy|disqualify|revert
connect-workable comments list|add
connect-workable activities list
connect-workable offers get|create
connect-workable members list
connect-workable recruiters list
connect-workable stages list
connect-workable metadata disqualification-reasons|departments|custom-attributes
connect-workable events list|schedule
connect-workable profile list|use|create|delete|show
connect-workable config set-key|set-subdomain|show|clear
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
```
