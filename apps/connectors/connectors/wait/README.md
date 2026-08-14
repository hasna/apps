# connect-wait

TypeScript connector for the [Wait](https://wait.com) delay workflow platform API.

## Features

- Bearer token authentication (`WAIT_API_KEY`)
- Multi-profile configuration
- Delays, events, search, and raw request support
- CLI and programmatic library API

## Quick Start

```bash
cd connectors/wait
bun install
bun run dev config set-key <your-api-key>
bun run dev delays list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WAIT_API_KEY` | API key (overrides profile config) |
| `WAIT_BASE_URL` | Override base URL (default: `https://api.wait.com/v1`) |

## CLI Commands

```bash
connect-wait profile list|use|create|delete|show
connect-wait config set-key|set-url|show|clear
connect-wait delays list|get <id>|create --body '{}'
connect-wait events list
connect-wait search run --body '{}'
connect-wait raw-request --path /delays [--method GET] [--query '{}'] [--body '{}']
```

## Library Usage

```typescript
import { Wait } from '@hasna/connect-wait';

const wait = Wait.fromEnv();
const delays = await wait.listDelays();
const delay = await wait.getDelay('delay-id');
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
