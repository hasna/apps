# connect-split-io

TypeScript connector for the [Split.io Admin API v2](https://docs.split.io/reference/). Manage feature flags, segments, environments, change requests, and more.

## Features

- Bearer token authentication (Admin API key)
- Multi-profile configuration
- CLI with Commander.js
- Programmatic API wrapper
- Pretty and JSON output formats

## Quick Start

```bash
cd connectors/split-io
bun install
bun run dev config set-api-key <your-admin-api-key>
bun run dev validate
bun run dev workspaces list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPLIT_IO_API_KEY` | Admin API key (overrides profile) |

Get your Admin API key from [Split.io account settings](https://app.split.io/account/admin).

## CLI Commands

```bash
# Configuration
connect-split-io config set-api-key <key>
connect-split-io config show
connect-split-io validate

# Workspaces & environments
connect-split-io workspaces list
connect-split-io environments list <workspaceId>

# Feature flags (splits)
connect-split-io splits list <workspaceId>
connect-split-io splits get <workspaceId> <splitName>
connect-split-io splits kill <workspaceId> <splitName> <environmentName>

# Segments
connect-split-io segments list <workspaceId>
connect-split-io segments keys <segmentName> <environmentName>

# Change requests
connect-split-io change-requests list
connect-split-io change-requests approve <id>
```

## Programmatic Usage

```typescript
import { SplitIo } from '@hasna/connect-split-io';

const client = SplitIo.fromEnv();
const workspaces = await client.listWorkspaces();
const splits = await client.listSplits('workspace-id');
```

## Data Storage

```
~/.hasna/connectors/connect-split-io/
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
