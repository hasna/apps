# @hasna/connect-weights-biases

TypeScript connector for the [Weights & Biases](https://wandb.ai/) REST API — ML experiment tracking with runs, events, and search.

## Install

```bash
bun add @hasna/connect-weights-biases
```

Or use via the main `@hasna/connectors` CLI/MCP.

## Authentication

Get an API key from [wandb.ai/authorize](https://wandb.ai/authorize).

```bash
export WANDB_API_KEY=your-api-key-here
# or
weights-biases config set-key your-api-key-here
```

## CLI

```bash
# Configuration
weights-biases config show
weights-biases profile list

# Runs
weights-biases runs list --entity my-team --project my-project
weights-biases runs get <run-id>
weights-biases runs create --body '{"entity":"team","project":"demo","displayName":"test"}'

# Events
weights-biases events list --run-id <run-id>

# Search
weights-biases search query --body '{"entity":"team","project":"demo","filters":{}}'

# Raw request
weights-biases request /runs -X GET --query '{"perPage":10}'
```

## Library

```typescript
import { WeightsBiases } from '@hasna/connect-weights-biases';

const wb = WeightsBiases.fromEnv();
const runs = await wb.runs.list({ entity: 'team', project: 'demo' });
```

## API base URL

Default: `https://api.wandb.ai/v1`

Override with `WANDB_BASE_URL` or `weights-biases config set-base-url`.

## License

Apache-2.0
