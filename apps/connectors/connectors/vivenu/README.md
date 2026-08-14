# connect-vivenu

TypeScript connector for the [Vivenu Distribution API](https://docs.vivenu.dev/distribution) — event ticketing for sellers, events, availabilities, and checkouts.

## Features

- Multi-profile configuration
- API key + distributor type authentication (per Vivenu Distribution API spec)
- CLI commands for all five core distribution operations
- Library exports for programmatic use
- TypeScript with strict mode

## Quick Start

```bash
cd connectors/vivenu
bun install

# Configure credentials
bun run dev config set-key <your-api-key>
bun run dev config set-distributor-type <your-distributor-type>

# List sellers
bun run dev distribution list-sellers

# List events for a seller
bun run dev distribution list-events --distributor-id <seller-distributor-id>
```

## CLI Commands

```bash
connect-vivenu profile list|use|create|delete|show
connect-vivenu config set-key|set-distributor-type|set-base-url|show|clear

connect-vivenu distribution list-sellers [--top N] [--skip N] [--seller-id ID]
connect-vivenu distribution list-events --distributor-id ID [--start DATE] [--end DATE]
connect-vivenu distribution get-event --id EVENT_ID --distributor-id ID
connect-vivenu distribution list-availabilities --id EVENT_ID --distributor-id ID
connect-vivenu distribution create-checkout --body '<json>' | --body-file path.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VIVENU_API_KEY` | Secret API key (raw Authorization header value) |
| `VIVENU_DISTRIBUTOR_TYPE` | Registered distributor type identifier |
| `VIVENU_BASE_URL` | Optional API base URL (default `https://vivenu.com`) |

## Authentication

The Vivenu Distribution API uses:
- `Authorization` header with the raw API key (not `Bearer`)
- `x-distributor-type` header identifying your integration

## Development

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
