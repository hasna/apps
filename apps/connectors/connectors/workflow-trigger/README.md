# connect-workflow-trigger

TypeScript connector and CLI for the [WorkflowTrigger](https://workflow-trigger.com) REST API.

## Install

```bash
bun install
```

## Configuration

```bash
export WORKFLOW_TRIGGER_API_KEY=your-api-key
# optional:
export WORKFLOW_TRIGGER_BASE_URL=https://api.workflow-trigger.com/v1
```

Or use the CLI profile:

```bash
bun run dev config set-key your-api-key
```

## Usage

```bash
# List triggers
bun run dev triggers list

# Get a trigger
bun run dev triggers get trigger-id

# Create a trigger
bun run dev triggers create --body '{"name":"My trigger"}'

# List events
bun run dev events list

# Search
bun run dev search --body '{"query":"keyword"}'

# Raw API request
bun run dev raw --path /triggers --method GET
```

## Library

```typescript
import { Connector } from '@hasna/connect-workflow-trigger';

const client = new Connector({ apiKey: process.env.WORKFLOW_TRIGGER_API_KEY! });
const triggers = await client.triggers.list();
```

## License

Apache-2.0
