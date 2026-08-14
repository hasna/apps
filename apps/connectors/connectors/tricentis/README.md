# connect-tricentis

TypeScript connector for the [Tricentis](https://www.tricentis.com/) test automation platform API.

## Features

- Bearer token authentication with multi-profile configuration
- Tests: list, get, create
- Events listing and global search
- Raw request escape hatch for undocumented endpoints
- Configurable base URL for tenant-specific hosts

## Quick Start

```bash
bun install
export TRICENTIS_API_KEY=your-api-key
bun run dev tests list
```

## Authentication

Bearer Token authentication. Credentials can be set via:

- Environment variable `TRICENTIS_API_KEY`
- Profile configuration: `connect-tricentis config set-key <key>`

Some Tricentis products use per-tenant hosts. Override the default `https://api.tricentis.com/v1` with `TRICENTIS_BASE_URL` or `connect-tricentis config set-base-url <url>`.

## CLI Commands

```bash
# Configuration
connect-tricentis config set-key <key>
connect-tricentis config set-base-url <url>
connect-tricentis config show

# Tests
connect-tricentis tests list [--limit N] [--offset N]
connect-tricentis tests get <testId>
connect-tricentis tests create --name "My test"

# Events & search
connect-tricentis events list
connect-tricentis search --query "keyword"

# Arbitrary request
connect-tricentis raw-request --path /tests -X GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRICENTIS_API_KEY` | API key / bearer token (overrides profile) |
| `TRICENTIS_BASE_URL` | API base URL override (optional) |

## Development

```bash
bun run dev
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
