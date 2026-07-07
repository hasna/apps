# @hasna/connect-vwo

TypeScript connector for the [VWO](https://vwo.com/) REST API — A/B testing, feature flags, surveys, heatmaps, and conversion rate optimization.

## Installation

```bash
bun install
```

## Configuration

Set credentials via environment variables or CLI:

```bash
export VWO_API_TOKEN=your-api-token
export VWO_ACCOUNT_ID=your-account-id

# Or via CLI profile
connect-vwo config set --api-token <token> --account-id <id>
```

See `.env.example` for placeholder variable names.

## Usage

### CLI

```bash
bun run dev account
bun run dev campaigns list
bun run dev feature-flags list
```

### Library

```typescript
import { Connector } from '@hasna/connect-vwo';

const vwo = Connector.fromEnv();
const account = await vwo.account.me();
const campaigns = await vwo.campaigns.list({ limit: 10 });
```

## API Coverage

- Account
- Campaigns (run, pause, report)
- Goals, Segments, Metrics
- Feature flags and environments
- Surveys, heatmaps, session recordings
- Webhooks, audit log, users

## Development

```bash
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## License

Apache-2.0
