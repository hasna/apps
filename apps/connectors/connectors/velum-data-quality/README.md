# @hasna/connect-velum-data-quality

TypeScript connector for the [Velum](https://www.ycombinator.com/companies/velum-labs) data quality platform API.

## Features

- Bearer API key authentication
- Data quality checks (list, create, get)
- Events listing
- Search API
- Raw request escape hatch
- Multi-profile configuration

## Installation

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set your API key:

```bash
VELUM_DATA_QUALITY_API_KEY=your-api-key-here
```

Or use the CLI:

```bash
bun run dev config set-key your-api-key-here
```

## CLI Usage

```bash
bun run dev checks list
bun run dev checks get <checkId>
bun run dev checks create --body '{"name":"my-check"}'
bun run dev events list
bun run dev search --body '{"query":"status:failed"}'
bun run dev raw --path /checks --method GET
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-velum-data-quality';

const client = Connector.fromEnv();
const checks = await client.checks.list();
const events = await client.events.list();
const results = await client.search.search({ query: 'status:failed' });
```

## License

Apache-2.0
