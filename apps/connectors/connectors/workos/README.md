# connect-workos

TypeScript connector for the [WorkOS](https://workos.com) REST API with multi-profile CLI support.

## Features

- Organizations, SSO connections, directories, directory users, and events
- Bearer API key authentication
- Multi-profile configuration
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/workos
bun install
export WORKOS_API_KEY=your-api-key
bun run dev organizations list
```

## CLI Commands

```bash
connect-workos config set-key <key>
connect-workos organizations list [--limit 10] [--search "Acme"]
connect-workos connections list [--organization-id org_...]
connect-workos directories list [--organization-id org_...]
connect-workos directory-users list --directory-id directory_...
connect-workos events list [--organization-id org_...] [--after event_...]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORKOS_API_KEY` | WorkOS API key (overrides profile) |

## Development

```bash
bun run dev
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
