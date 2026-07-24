# connect-tettra

TypeScript connector and CLI for the [Tettra](https://tettra.co) team knowledge base REST API v1.

## API

- **Base URL**: `https://api.tettra.co/v1`
- **Auth**: Bearer token (`TETTRA_API_KEY`)
- **Note**: Tettra also exposes legacy team endpoints at `app.tettra.co`; this connector targets the v1 API only.

## Quick Start

```bash
bun install
export TETTRA_API_KEY=your-api-key
bun run dev pages list
bun run dev search query -q "onboarding"
```

## CLI Commands

```bash
connect-tettra pages list
connect-tettra pages get <pageId>
connect-tettra pages create -t "Title" -c "Content"
connect-tettra events list
connect-tettra search query -q "query text"
```

Use `--body <json>` on `pages create` and `search query` to send the full POST payload.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TETTRA_API_KEY` | API key (overrides profile) |
| `TETTRA_BASE_URL` | Optional API base URL override |

## License

Apache-2.0
