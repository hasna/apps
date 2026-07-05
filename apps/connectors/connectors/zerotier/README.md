# connect-zerotier

TypeScript connector and CLI for the [ZeroTier Central REST API](https://docs.zerotier.com/api/central/legacy/).

## Features

- ZeroTier Central network and member management
- Organization users, invites, SSO config, and audit logs
- Multi-profile configuration
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/zerotier
bun install

# Set API key (from https://my.zerotier.com → Account → API Access)
export ZEROTIER_API_KEY=your-api-key

bun run dev status
bun run dev network list
```

## Authentication

ZeroTier Central uses an **API key** sent as `Authorization: token <key>`.

```bash
connect-zerotier config set-key <your-api-key>
# or
export ZEROTIER_API_KEY=your-api-key
```

## CLI Examples

```bash
connect-zerotier status
connect-zerotier account
connect-zerotier network list
connect-zerotier network get <networkId>
connect-zerotier member list <networkId>
connect-zerotier member authorize <networkId> <nodeId>
connect-zerotier org list
connect-zerotier org audit list <orgId> --limit 25
```

## Library Usage

```typescript
import { ZeroTier } from '@hasna/connect-zerotier';

const zt = ZeroTier.fromEnv();
const networks = await zt.listNetworks();
const status = await zt.getStatus();
```

## License

Apache-2.0
