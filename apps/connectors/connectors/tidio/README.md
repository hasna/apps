# connect-tidio

TypeScript connector for the [Tidio OpenAPI](https://developers.tidio.com/reference). Manage live chat contacts, conversations, operators, tags, webhooks, and more.

## Features

- Multi-profile configuration
- `X-Tidio-Openapi-Key` authentication
- Contacts, conversations, operators, departments, tags, automations, canned responses, webhooks
- Pretty and JSON output formats
- Automatic retry on rate limits (429) and server errors (5xx)

## Quick Start

```bash
cd connectors/tidio
bun install
bun run dev --help
bun run dev config set-key YOUR_API_KEY
bun run dev project get
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIDIO_API_KEY` | OpenAPI key (overrides profile) |

## CLI Commands

```bash
connect-tidio contact list|get|create|update|delete
connect-tidio conversation list|get|messages|send|status|assign
connect-tidio operator list|get
connect-tidio department list
connect-tidio tag list|create|delete
connect-tidio automation list
connect-tidio canned-response list|create
connect-tidio webhook list|create|delete
connect-tidio project get
connect-tidio profile list|use|create|delete|show
connect-tidio config set-key|show|clear
```

## Build

```bash
bun run build
bun run typecheck
```

## License

Apache-2.0
