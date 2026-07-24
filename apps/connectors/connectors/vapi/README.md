# connect-vapi

TypeScript connector for the [Vapi](https://vapi.ai) voice AI platform. Manage voice assistants, calls, phone numbers, and tools via CLI or library.

## Features

- Multi-profile configuration
- Bearer token authentication
- Assistants, calls, phone numbers, and tools APIs
- Raw request escape hatch
- Pretty and JSON output formats

## Quick Start

```bash
cd connectors/vapi
bun install
bun run dev config set-key <your-vapi-api-key>
bun run dev assistants list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VAPI_API_KEY` | Vapi API key (overrides profile) |
| `VAPI_BASE_URL` | Optional API base URL (default: `https://api.vapi.ai`) |

## CLI Commands

```bash
connect-vapi profile list|use|create|delete|show
connect-vapi config set-key|set-base-url|show|clear
connect-vapi assistants list|get|create
connect-vapi calls list|create
connect-vapi phone-numbers list
connect-vapi tools list
connect-vapi raw-request --path /assistant [--method GET] [--body '{}']
```

## Library Usage

```typescript
import { Vapi } from '@hasna/connect-vapi';

const vapi = Vapi.fromEnv();
const assistants = await vapi.assistants.list({ limit: 10 });
```

## API Reference

- [Vapi API docs](https://docs.vapi.ai/api-reference)

## License

Apache-2.0
