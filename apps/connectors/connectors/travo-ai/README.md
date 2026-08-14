# @hasna/connect-travo-ai

TypeScript connector for the [Travo](https://travo.ai) travel AI platform API.

## Features

- REST client for trips, events, and search endpoints
- Bearer token authentication via API key
- Multi-profile configuration
- CLI with JSON and pretty output formats

## Quick Start

```bash
bun install
export TRAVO_AI_API_KEY=your-api-key
bun run dev trips list
```

## CLI

```bash
connect-travo-ai profile list
connect-travo-ai config set-key <api-key>
connect-travo-ai trips list
connect-travo-ai trips get <tripId>
connect-travo-ai trips create --body '{"destination":"Paris"}'
connect-travo-ai events list
connect-travo-ai search --query "weekend in Lisbon"
connect-travo-ai raw --path /trips --method GET
```

## Library

```typescript
import { TravoAi } from '@hasna/connect-travo-ai';

const travo = TravoAi.fromEnv();
const trips = await travo.listTrips();
const trip = await travo.getTrip('trip-id');
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRAVO_AI_API_KEY` | API key (Bearer token) |
| `TRAVO_AI_BASE_URL` | Optional API base URL (default `https://api.travo.ai/v1`) |

## License

Apache-2.0
