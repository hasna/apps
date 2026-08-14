# Workato Connector

TypeScript CLI and library for the [Workato](https://www.workato.com/) REST API.

## Features

- Bearer token authentication
- Recipes, jobs, connections, folders, projects
- Lookup tables, properties, and users
- Multi-profile configuration
- HTTPS-only base URL validation

## Installation

```bash
bun install
```

## Configuration

```bash
# Set API token
connect-workato config set-token <your-token>

# Optional custom base URL (HTTPS only)
connect-workato config set-base-url https://www.workato.com/api
```

Environment variables:

| Variable | Description |
|----------|-------------|
| `WORKATO_API_TOKEN` | API token |
| `WORKATO_BASE_URL` | Optional API base URL |

## Usage

```bash
# List recipes
connect-workato recipes list --folder-id 10 --per-page 20

# Start/stop a recipe
connect-workato recipes start 123
connect-workato recipes stop 123

# List jobs for a recipe
connect-workato jobs list 123 --status succeeded

# Manage connections
connect-workato connections list --provider salesforce
connect-workato connections create --name CRM --provider salesforce

# Export a project
connect-workato projects export 4 --include-data
```

## Development

```bash
bun run dev recipes list
bun run typecheck
bun test
```

## License

Apache-2.0
