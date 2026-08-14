# connect-usebidflow

TypeScript API connector for the [Bidflow Platform](https://usebidflow.com) REST API.

## Features

- Bearer token authentication
- Multi-profile configuration
- Bids: list, get, create
- Events: list
- Marketplace search
- Raw request escape hatch

## Install

```bash
bun install
```

## Configuration

```bash
export USEBIDFLOW_API_KEY=your-api-key-here
# optional
export USEBIDFLOW_BASE_URL=https://api.usebidflow.com/v1

# or via profile
connect-usebidflow config set-key your-api-key-here
```

Profiles are stored under `~/.hasna/connectors/connect-usebidflow/`.

## CLI Usage

```bash
# Bids
connect-usebidflow bids list
connect-usebidflow bids get <bidId>
connect-usebidflow bids create --data '{"title":"Example"}'

# Events
connect-usebidflow events list

# Search
connect-usebidflow search --query "widgets"
connect-usebidflow search --data '{"query":"widgets","filters":{}}'

# Raw API request
connect-usebidflow raw --path /bids --method GET
connect-usebidflow raw --path /search --method POST --data '{"query":"test"}'

# Output as JSON
connect-usebidflow --format json bids list
```

## Library Usage

```typescript
import { Usebidflow } from '@hasna/connect-usebidflow';

const client = Usebidflow.fromEnv();
const bids = await client.bids.list();
const bid = await client.bids.get('bid-id');
```

## Development

```bash
bun run dev -- bids list
bun test
bun run typecheck
bun run build
```

## License

Apache-2.0
