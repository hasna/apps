# connect-trigger-dev

TypeScript connector for [Trigger.dev](https://trigger.dev) — background jobs, workflows, and automation.

## Features

- Bearer API key authentication
- Multi-profile configuration
- Runs, task trigger, run events, and TRQL query API coverage
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
TRIGGER_SECRET_KEY=your-secret-key-here
# optional:
TRIGGER_DEV_BASE_URL=https://api.trigger.dev/api/v1
```

## CLI

```bash
connect-trigger-dev runs list
connect-trigger-dev runs get <runId>
connect-trigger-dev runs create --task my-task --payload '{"hello":"world"}'
connect-trigger-dev events list <runId>
connect-trigger-dev search --body '{"query":"SELECT run_id, status FROM runs LIMIT 10"}'
connect-trigger-dev raw --path /runs -X GET
```

## Library

```typescript
import { TriggerDev } from '@hasna/connect-trigger-dev';

const client = new TriggerDev({ apiKey: process.env.TRIGGER_SECRET_KEY! });
const runs = await client.listRuns();
const triggered = await client.triggerTask({ taskIdentifier: 'my-task', payload: { hello: 'world' } });
```

## License

Apache-2.0
