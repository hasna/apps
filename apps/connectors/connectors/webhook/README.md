# connect-webhook

TypeScript connector for the [Webhook](https://www.ycombinator.com/companies/webhook) API — manage hooks, list events, search resources, and send raw requests.

## Quick Start

```bash
cd connectors/webhook
bun install
export WEBHOOK_API_KEY=your-api-key

bun run dev hooks list
bun run dev hooks create --name my-hook --url https://example.com/hook
bun run dev hooks get <hookId>
bun run dev events list
bun run dev search --query invoice
bun run dev raw-request --path /hooks --method GET
```

## Authentication

- **API key**: Bearer token via `WEBHOOK_API_KEY` or `connect-webhook config set-key <key>`
- **Base URL** (optional): `WEBHOOK_BASE_URL` (default `https://api.webhook.com/v1`)

## CLI Commands

| Command | Description |
|---------|-------------|
| `hooks list` | List hooks (`GET /hooks`) |
| `hooks create` | Create a hook (`POST /hooks`) |
| `hooks get <hookId>` | Get hook details (`GET /hooks/{id}`) |
| `events list` | List events (`GET /events`) |
| `search` | Search resources (`POST /search`) |
| `raw-request` | Arbitrary authenticated request |

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
