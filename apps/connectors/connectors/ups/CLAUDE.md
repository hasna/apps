# CLAUDE.md

UPS shipping and logistics API connector (`@hasna/connect-ups`).

## Auth

**api_key** — Bearer token authentication. Store your UPS OAuth access token or API bearer token as `UPS_API_KEY` (environment) or via `connect-ups config set-key`.

Optional `UPS_BASE_URL` overrides the default `https://api.ups.com/v1`.

## Commands

```bash
bun install
bun run dev --help
bun run typecheck
bun test
```

## CLI

```bash
connect-ups config set-key <token>
connect-ups config set-base-url <url>
connect-ups shipments list
connect-ups shipments get <shipmentId>
connect-ups shipments create --file body.json
connect-ups events list
connect-ups search --file query.json
connect-ups raw-request --path /shipments --method GET
```

## API surface

- `listShipments` — GET `/shipments`
- `createShipment` — POST `/shipments`
- `getShipment` — GET `/shipments/:id`
- `listEvents` — GET `/events`
- `search` — POST `/search`
- `rawRequest` — arbitrary path/method

Profiles live in `~/.hasna/connectors/connect-ups/profiles/`.

## Environment

| Variable | Description |
|----------|-------------|
| `UPS_API_KEY` | Bearer token / API key |
| `UPS_BASE_URL` | Optional API base URL |
