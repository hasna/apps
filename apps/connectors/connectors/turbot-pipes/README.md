# connect-turbot-pipes

TypeScript connector for the [Turbot Pipes](https://pipes.turbot.com) cloud intelligence API.

## Features

- Multi-profile configuration
- Bearer token authentication
- Workspaces, snapshots, SQL queries, and process listing
- CLI and programmatic API

## Quick Start

```bash
cd connectors/turbot-pipes
bun install
bun run dev config set-token <your-api-token>
bun run dev validate
bun run dev user
```

## CLI Commands

```bash
# Configuration
connect-turbot-pipes config set-token <token>
connect-turbot-pipes config show
connect-turbot-pipes validate

# Profile management
connect-turbot-pipes profile list
connect-turbot-pipes profile use <name>

# API operations
connect-turbot-pipes user
connect-turbot-pipes workspaces list --org <orgHandle>
connect-turbot-pipes workspace get --org <orgHandle> --workspace <workspaceHandle>
connect-turbot-pipes snapshots list --org <orgHandle> --workspace <workspaceHandle>
connect-turbot-pipes query run --org <orgHandle> --workspace <workspaceHandle> --sql "select 1"
connect-turbot-pipes processes list --org <orgHandle> --workspace <workspaceHandle>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURBOT_PIPES_API_TOKEN` | API token (overrides profile) |

## API Documentation

https://pipes.turbot.com/api/latest/docs

## License

Apache-2.0
