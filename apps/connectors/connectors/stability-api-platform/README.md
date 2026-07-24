# connect-stability-api-platform

TypeScript connector for the [Stability Api Platform](https://api.stabilityapiplatform.com) REST API — items, events, search, and raw API access.

## Install

```bash
bun install -g @hasna/connect-stability-api-platform
```

## Quick start

```bash
connect-stability-api-platform config set-key YOUR_API_KEY
connect-stability-api-platform items list
connect-stability-api-platform items get item-1
connect-stability-api-platform events list
connect-stability-api-platform search --body '{"q":"example"}'
```

## Library usage

```typescript
import { StabilityApiPlatform } from '@hasna/connect-stability-api-platform';

const client = new StabilityApiPlatform({ apiKey: process.env.STABILITY_API_PLATFORM_API_KEY! });
const items = await client.listItems();
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `STABILITY_API_PLATFORM_API_KEY` | Bearer API key |
| `STABILITY_API_PLATFORM_BASE_URL` | Optional base URL override (default `https://api.stabilityapiplatform.com/v1`) |

## Configuration

Profiles are stored under `~/.hasna/connectors/connect-stability-api-platform/`.

## License

Apache-2.0
