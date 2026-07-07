# @hasna/connect-speakeasy-api

TypeScript connector for the [Speakeasy API](https://speakeasy.com/docs) — manage APIs, endpoints, schemas, event logs, and workspace events.

## Features

- `x-api-key` authentication against `https://api.prod.speakeasyapi.dev`
- Multi-profile configuration under `~/.hasna/connectors/connect-speakeasy-api/`
- Library + CLI for auth, APIs, endpoints, metadata, schemas, eventlog, embeds, and events
- Typed client with retry on 429/5xx

## Quick Start

```bash
cd connectors/speakeasy-api
bun install
export SPEAKEASY_API_KEY=your-key
bun run dev auth validate
bun run dev apis list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPEAKEASY_API_KEY` | API key (x-api-key header) |
| `SPEAKEASY_TOKEN` | Alias for API key |
| `SPEAKEASY_BASE_URL` | Override base URL (default: `https://api.prod.speakeasyapi.dev`) |
| `SPEAKEASY_WORKSPACE_ID` | Default workspace ID for events |

## CLI Commands

```bash
connect-speakeasy-api auth validate
connect-speakeasy-api apis list
connect-speakeasy-api apis versions <apiID>
connect-speakeasy-api endpoints list <apiID> <versionID>
connect-speakeasy-api schemas get <apiID> <versionID>
connect-speakeasy-api eventlog query --filters '{"filters":[],"limit":10,"offset":0,"operator":"and"}'
connect-speakeasy-api embeds list
connect-speakeasy-api events post --workspace-id <id> --body '[...]'
connect-speakeasy-api raw GET /v1/auth/validate
```

## License

Apache-2.0
