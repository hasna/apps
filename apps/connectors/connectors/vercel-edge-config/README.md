# @hasna/connect-vercel-edge-config

TypeScript connector and CLI for the [Vercel Edge Config management API](https://vercel.com/docs/rest-api/edge-config).

## Features

- List, create, update, and delete Edge Configs
- Batch item updates (PATCH `/v1/edge-config/{id}/items`)
- Get individual items, schema, read tokens, and backups
- Multi-profile configuration with Bearer token auth
- Library exports for programmatic use

## Quick Start

```bash
cd connectors/vercel-edge-config
bun install

# Configure API token (from https://vercel.com/account/tokens)
bun run dev config set-key your-token-here
bun run dev config set-team team_xxx   # optional, for team scope

# List Edge Configs
bun run dev edge-config list
```

## Environment Variables

```bash
export VERCEL_TOKEN=your-token
export VERCEL_TEAM_ID=team_xxx          # optional
export VERCEL_EDGE_CONFIG_BASE_URL=https://api.vercel.com  # optional
```

## Library Usage

```typescript
import { VercelEdgeConfig } from '@hasna/connect-vercel-edge-config';

const client = new VercelEdgeConfig({
  apiKey: process.env.VERCEL_TOKEN!,
  teamId: process.env.VERCEL_TEAM_ID,
});

const { edgeConfigs } = await client.listEdgeConfigs();
await client.patchItems('ecfg_xxx', {
  items: [{ operation: 'upsert', key: 'feature_x', value: true }],
});
```

## License

Apache-2.0
