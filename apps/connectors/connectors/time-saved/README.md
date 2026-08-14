# connect-time-saved

TypeScript connector for the [TimeSaved](https://time-saved.com) time analytics platform API.

## Install

```bash
bun install
```

## Authentication

Bearer token authentication. Set credentials via environment variable or profile:

```bash
export TIMESAVED_API_KEY=your-api-key
# or
connect-time-saved config set-key your-api-key
```

## CLI

```bash
bun run dev reports list
bun run dev reports get <reportId>
bun run dev reports create --body '{"name":"Q1"}'
bun run dev events list
bun run dev search --body '{"query":"focus time"}'
bun run dev request --method GET --path /reports
```

## API

- Base URL: `https://api.time-saved.com/v1`
- Auth: `Authorization: Bearer <api_key>`
- Endpoints: `/reports`, `/reports/:id`, `/events`, `/search`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIMESAVED_API_KEY` | API key (primary) |
| `TIMESAVED_TOKEN` | Alias for API key |
| `TIMESAVED_BASE_URL` | Optional base URL override |

## License

Apache-2.0
