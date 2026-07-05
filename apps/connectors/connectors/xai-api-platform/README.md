# connect-xai-api-platform

TypeScript CLI and library for the [Xai API Platform](https://www.ycombinator.com/companies/xai-api-platform) REST API.

> **Not the same as xAI Grok.** This connector targets `api.xaiapiplatform.com` (items, events, search). For Grok chat models use the separate `connect-xai` connector (`api.x.ai`).

## Features

- Bearer token authentication with multi-profile support
- Items: list, create, get
- Events: list
- Search endpoint
- Raw REST requests for advanced use cases
- JSON and pretty CLI output

## Quick Start

```bash
bun install
export XAI_API_PLATFORM_API_KEY=your-api-key-here
bun run dev items list
```

## CLI Commands

```bash
# Configuration
connect-xai-api-platform config set-key <key>
connect-xai-api-platform config set-base-url <url>
connect-xai-api-platform config show

# Profiles
connect-xai-api-platform profile list|use|create|delete|show

# API operations
connect-xai-api-platform items list [--query '{"limit":10}']
connect-xai-api-platform items create --body '{"name":"example"}'
connect-xai-api-platform items get <itemId>
connect-xai-api-platform events list [--query '{"limit":10}']
connect-xai-api-platform search --body '{"q":"example"}'
connect-xai-api-platform raw --path /items [--method GET] [--query '{}'] [--body '{}']
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XAI_API_PLATFORM_API_KEY` | API key (Bearer token) |
| `XAI_API_PLATFORM_BASE_URL` | Optional base URL (default: `https://api.xaiapiplatform.com/v1`) |

## Library Usage

```typescript
import { XaiApiPlatform } from '@hasna/connect-xai-api-platform';

const client = new XaiApiPlatform({ apiKey: process.env.XAI_API_PLATFORM_API_KEY! });
const items = await client.listItems();
```

## License

Apache-2.0
