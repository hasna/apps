# @hasna/connect-zipkin

TypeScript connector and CLI for the [Zipkin Cloud REST API](https://api.zipkin.io/v1).

## Features

- Bearer token authentication
- Multi-profile configuration
- Trace listing, retrieval, and creation
- Event listing
- Trace search via POST `/search`
- Raw API escape hatch
- Optional `base_url` override for self-hosted Zipkin servers

## Quick Start

```bash
cd connectors/zipkin
bun install
bun run dev config set-key <your-api-key>
bun run dev traces list --service-name my-service
```

## CLI Commands

```bash
zipkin config set-key <key>          # Set API key
zipkin config set-base-url <url>     # Override base URL
zipkin config show                   # Show active profile config

zipkin profile list                  # List profiles
zipkin profile use <name>            # Switch profile
zipkin profile create <name>         # Create profile

zipkin traces list [--service-name <name>] [--limit 10]
zipkin traces get <traceId>
zipkin traces create --json '<spans-json>'

zipkin events list [--trace-id <id>] [--limit <n>]
zipkin search [--json '<body>'] [--service-name <name>]
zipkin raw <METHOD> <path> [--json '<body>'] [--params '<json>']
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZIPKIN_API_KEY` | API key (overrides profile) |
| `ZIPKIN_BASE_URL` | API base URL (default: `https://api.zipkin.io/v1`) |

## Self-Hosted Zipkin

This connector defaults to Zipkin Cloud (`https://api.zipkin.io/v1`). For self-hosted Zipkin servers, set `ZIPKIN_BASE_URL` to your server's API path (for example `http://localhost:9411/api/v2`).

## License

Apache-2.0
