# connect-vercel-edge-config-platform

TypeScript connector for the Vercel Edge Config management REST API (`api.vercel.com/v1/edge-config`).

## Features

- Manage Edge Configs (list, create, get, update, delete)
- Item operations (list, get, batch patch)
- Schema CRUD
- Token management
- Backup list, get, and restore
- Multi-profile configuration with Bearer token auth

## Quick Start

```bash
bun install
bun run dev config set-key <your-vercel-token>
bun run dev edge-config ls
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | Vercel API token (overrides profile) |
| `VERCEL_TEAM_ID` | Team ID for team-scoped requests |

Get a token at https://vercel.com/account/tokens

## CLI Commands

```bash
# Profiles & config
connect-vercel-edge-config-platform profile list
connect-vercel-edge-config-platform config set-key <token>
connect-vercel-edge-config-platform config set-team <teamId>

# Edge Configs
connect-vercel-edge-config-platform edge-config ls
connect-vercel-edge-config-platform edge-config create <slug>
connect-vercel-edge-config-platform edge-config get <id>
connect-vercel-edge-config-platform edge-config update <id> <slug>
connect-vercel-edge-config-platform edge-config delete <id>

# Items
connect-vercel-edge-config-platform item ls <edgeConfigId>
connect-vercel-edge-config-platform item get <edgeConfigId> <key>
connect-vercel-edge-config-platform item patch <edgeConfigId> --items '[{"operation":"upsert","key":"foo","value":true}]'

# Schema, tokens, backups
connect-vercel-edge-config-platform schema get <edgeConfigId>
connect-vercel-edge-config-platform token create <edgeConfigId> <label>
connect-vercel-edge-config-platform backup ls <edgeConfigId>
connect-vercel-edge-config-platform backup restore <edgeConfigId> <versionId>
```

## Library Usage

```typescript
import { EdgeConfigPlatform } from '@hasna/connect-vercel-edge-config-platform';

const client = new EdgeConfigPlatform({ apiKey: process.env.VERCEL_TOKEN! });
const configs = await client.listEdgeConfigs();
```

## API Reference

Based on the official Vercel OpenAPI spec: https://openapi.vercel.sh

This connector covers the **management API** at `api.vercel.com`. Runtime reads via `edge-config.vercel.com` are out of scope (see the separate `vercel-edge-config` connector).

## License

Apache-2.0
