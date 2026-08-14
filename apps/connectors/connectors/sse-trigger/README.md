# connect-sse-trigger

TypeScript connector for the [SseTrigger](https://sse-trigger.com) API — SSE workflow triggers and event streams.

## Features

- Bearer token authentication
- Multi-profile configuration
- Streams, events, and search endpoints
- Arbitrary raw API requests
- CLI and library exports

## Quick Start

```bash
cd connectors/sse-trigger
bun install
bun run dev config set-key <your-api-key>
bun run dev streams list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SSE_TRIGGER_API_KEY` | API key (overrides profile) |
| `SSE_TRIGGER_BASE_URL` | Override base URL (default `https://api.sse-trigger.com/v1`) |

## CLI Commands

```bash
connect-sse-trigger profile list
connect-sse-trigger config set-key <key>
connect-sse-trigger streams list
connect-sse-trigger streams create --body '{"name":"my-stream"}'
connect-sse-trigger streams get <streamId>
connect-sse-trigger events list
connect-sse-trigger search run --body '{"query":"workflow"}'
connect-sse-trigger raw request --path /streams --method GET
```

## Library Usage

```typescript
import { SseTrigger } from '@hasna/connect-sse-trigger';

const client = new SseTrigger({ apiKey: process.env.SSE_TRIGGER_API_KEY! });
const streams = await client.listStreams();
const stream = await client.getStream('stream-id');
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/streams` | List streams |
| POST | `/streams` | Create stream |
| GET | `/streams/{id}` | Get stream |
| GET | `/events` | List events |
| POST | `/search` | Search events |

## License

Apache-2.0
