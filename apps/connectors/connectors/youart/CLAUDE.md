# CLAUDE.md

YouArt API connector for AI originals, membership tiers, and funding campaigns.

## Auth

- Type: `api_key` (Bearer token)
- Env: `YOUART_API_KEY`
- Optional base URL override: `YOUART_BASE_URL` (default `https://api.youart.ai/v1`)
- Profiles: `~/.hasna/connectors/youart/profiles/`

## Commands

```bash
bun install
bun run dev          # CLI from source
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## API surface

- `GET /projects`, `GET /projects/:id`, `POST /projects`
- `GET /originals`, `POST /originals/:id/publish`
- `GET /membership-tiers`
- `POST /funding-campaigns`
- `GET /backers`
- `rawRequest({ path, method, query, body })`

Path IDs are URL-encoded. POST bodies exclude reserved keys (`projectId`, `originalId`, `campaignId`, etc.).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOUART_API_KEY` | Bearer API key |
| `YOUART_BASE_URL` | Optional API base URL |
