# connect-teleport

TypeScript connector for the [Teleport](https://goteleport.com/) (Gravitational) API — privileged access management, zero-trust infrastructure access, sessions, users, roles, access requests, and audit events.

Public API docs: https://goteleport.com/docs/api/

## Authentication

Bearer token against your Teleport proxy URL:

| Variable | Description |
|----------|-------------|
| `TELEPORT_BASE_URL` | Teleport proxy URL (e.g. `https://teleport.example.com:443`) |
| `TELEPORT_TOKEN` | Teleport API bearer token |

Profiles are stored under `~/.hasna/connectors/connect-teleport/profiles/`.

## Quick Start

```bash
cd connectors/teleport
bun install
bun run dev config set --base-url https://teleport.example.com --token "$TELEPORT_TOKEN"
bun run dev ping
bun run dev nodes list
```

## CLI Commands

```bash
connect-teleport ping
connect-teleport nodes list [--query <q>]
connect-teleport sessions list --from <iso> --to <iso>
connect-teleport users list
connect-teleport roles list
connect-teleport access-requests list --state PENDING
connect-teleport tokens list
connect-teleport audit search --from <iso> --to <iso>
connect-teleport auth-connectors list
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
