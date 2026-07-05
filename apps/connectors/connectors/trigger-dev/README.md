# connect-trigger-dev

TypeScript connector for [Trigger.dev](https://trigger.dev) — background jobs, workflows, and automation.

## Features

- Bearer API key authentication
- Multi-profile configuration
- Runs, events, and search API coverage
- Raw request escape hatch
- CLI and programmatic library exports

## Quick Start

```bash
bun install
bun run dev config set-key <your-api-key>
bun run dev runs list
```

## Environment Variables

```bash
TRIGGER_DEV_API_KEY=your-api-key-here
# optional:
TRIGGER_DEV_BASE_URL=https://api.trigger.dev/v1
```

## CLI

```bash
connect-trigger-dev runs list
connect-trigger-dev runs get <runId>
connect-trigger-dev runs create --body '{"taskIdentifier":"my-task","payload":{}}'
connect-trigger-dev events list
connect-trigger-dev search --body '{"query":"status:failed"}'
connect-trigger-dev raw --path /runs -X GET
```

## Library

```typescript
import { TriggerDev } from '@hasna/connect-trigger-dev';

const client = new TriggerDev({ apiKey: process.env.TRIGGER_DEV_API_KEY! });
const runs = await client.listRuns();
```

## License

Apache-2.0
