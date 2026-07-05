# @hasna/connect-weights-biases-api-platform

TypeScript connector for the Weights & Biases API Platform REST API — items, events, and search.

This connector targets the API Platform endpoint (`https://api.weightsbiasesapiplatform.com/v1`), which is distinct from the standard W&B REST API at `https://api.wandb.ai/v1`.

## Install

```bash
bun add @hasna/connect-weights-biases-api-platform
```

Or use via the main `@hasna/connectors` CLI/MCP.

## Authentication

Bearer API key authentication. Obtain credentials from your W&B API Platform provider.

```bash
export WEIGHTS_BIASES_API_PLATFORM_API_KEY=your-api-key-here
# or
weights-biases-api-platform config set-key your-api-key-here
```

## CLI

```bash
# Configuration
weights-biases-api-platform config show
weights-biases-api-platform profile list

# Items
weights-biases-api-platform items list --per-page 10
weights-biases-api-platform items get <item-id>
weights-biases-api-platform items create --body '{"name":"demo","type":"model"}'

# Events
weights-biases-api-platform events list --item-id <item-id>

# Search
weights-biases-api-platform search query --body '{"query":"demo"}'

# Raw request
weights-biases-api-platform request /items -X GET --query '{"perPage":10}'
```

## Library

```typescript
import { WeightsBiasesApiPlatform } from '@hasna/connect-weights-biases-api-platform';

const wb = WeightsBiasesApiPlatform.fromEnv();
const items = await wb.items.list({ perPage: 10 });
```

## API base URL

Default: `https://api.weightsbiasesapiplatform.com/v1`

Override with `WEIGHTS_BIASES_API_PLATFORM_BASE_URL` or `weights-biases-api-platform config set-base-url`.

## Related documentation

- [Weights & Biases documentation](https://docs.wandb.ai/)
- [W&B Public API overview](https://docs.wandb.ai/models/ref/python/public-api)

## License

Apache-2.0
