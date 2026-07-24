# connect-tidio

TypeScript connector for the [Tidio OpenAPI](https://developers.tidio.com/reference).

## Features

- Tidio OpenAPI v1 server: `https://api.tidio.com/`
- Required `Accept: application/json; version=1` requests
- `X-Tidio-Openapi-Client-Id` and `X-Tidio-Openapi-Client-Secret` authentication
- Contacts, contact messages, departments, operators, project info, tickets, products, and Lyro data source helpers
- Secure local profiles with private config directories and profile files
- Pretty and JSON output formats
- Automatic retry on rate limits and server errors

This connector intentionally does not expose undocumented `/conversations`, `/tags`, `/automations`, `/canned-responses`, or `/webhooks` CRUD paths.

## Quick Start

```bash
cd connectors/tidio
bun install
bun run dev --help
bun run dev config set-credentials ci_your_client_id cs_your_client_secret
bun run dev project
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIDIO_CLIENT_ID` | OpenAPI client id, prefixed by `ci_` |
| `TIDIO_CLIENT_SECRET` | OpenAPI client secret, prefixed by `cs_` |

Environment variables override the active profile.

## CLI Commands

```bash
connect-tidio contact list|get|create|update|delete|properties|viewed-pages|messages|send-message
connect-tidio operator
connect-tidio department
connect-tidio project
connect-tidio ticket list|get|reply|tags|custom-fields
connect-tidio lyro sources|ask-ticket
connect-tidio profile list|use|create|delete|show
connect-tidio config set-credentials|show|clear
```

## Build

```bash
bun run build
bun run typecheck
```

## License

Apache-2.0
