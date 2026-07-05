# CLAUDE.md

Woodpecker cold email outreach API connector.

## Authentication

**API Key** via `x-api-key` header. Requires the API keys & integrations add-on.

| Variable | Description |
|----------|-------------|
| `WOODPECKER_API_KEY` | API key (overrides profile) |
| `WOODPECKER_BASE_URL` | Optional base URL override (default `https://api.woodpecker.co/rest`) |

Configure via CLI: `connect-woodpecker config set-key <key>`

## Commands

```bash
bun install
bun run dev campaigns list
bun run dev campaigns get <id>
bun run dev campaigns create --name "My campaign" --body campaign.json
bun run dev events list
bun run dev search prospects --search email=user@example.com
bun run dev raw --path /v1/campaign_list
bun run typecheck
bun test
bun run build
```

## API mapping

| Command | Endpoint |
|---------|----------|
| `listCampaigns` | `GET /v1/campaign_list` |
| `getCampaign` | `GET /v2/campaigns/{id}` |
| `createCampaign` | `POST /v2/campaigns` |
| `listEvents` | `GET /v2/webhooks` |
| `searchProspects` | `GET /v1/prospects?search=...` |

Docs: https://developers.woodpecker.co/docs/
