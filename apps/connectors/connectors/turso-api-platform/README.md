# Turso Api Platform Connector

TypeScript connector and CLI for the [Turso Api Platform](https://api.tursoapiplatform.com) REST API.

## Features

- Bearer token authentication
- Multi-profile configuration
- Items, events, and search endpoints
- Raw request escape hatch for custom paths

## Installation

```bash
bun install
```

## Configuration

```bash
connect-turso-api-platform auth set-key <api-key>
connect-turso-api-platform auth set-base-url https://api.tursoapiplatform.com/v1
connect-turso-api-platform auth status
```

Environment variables:

| Variable | Description |
|----------|-------------|
| `TURSO_API_PLATFORM_API_KEY` | API key |
| `TURSO_API_PLATFORM_BASE_URL` | Optional base URL override |

## CLI Commands

```bash
connect-turso-api-platform items list
connect-turso-api-platform items create --data '{"name":"example"}'
connect-turso-api-platform items get <itemId>
connect-turso-api-platform events list
connect-turso-api-platform search --data '{"query":"example"}'
connect-turso-api-platform raw --method GET --path /items
connect-turso-api-platform profile list|use|create|delete|show
```

## Development

```bash
bun run dev auth status
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
