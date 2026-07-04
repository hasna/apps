# @hasna/connect-zibra-labs

TypeScript connector for the [Zibra Labs](https://zibralabs.com) quant backtesting HPC API.

## Features

- List and inspect HPC clusters
- Submit, monitor, and cancel backtest jobs
- Browse available datasets
- Raw API request helper
- Multi-profile configuration with Bearer API key auth

## Quick Start

```bash
bun install
export ZIBRA_LABS_API_KEY=your-api-key
bun run dev clusters list
```

## CLI

```bash
connect-zibra-labs clusters list --region ny4
connect-zibra-labs clusters get "cluster 1"
connect-zibra-labs backtests submit --body '{"strategy_ref":"s3://strategies/mean-reversion.py"}'
connect-zibra-labs backtests get "job 1"
connect-zibra-labs backtests cancel "job 1" --body '{"reason":"risk limit"}'
connect-zibra-labs datasets list --asset-class equities
connect-zibra-labs raw -m POST -p /custom/jobs -b '{"dry_run":true}'
```

## Library

```typescript
import { ZibraLabs } from '@hasna/connect-zibra-labs';

const client = new ZibraLabs({ apiKey: process.env.ZIBRA_LABS_API_KEY! });
const clusters = await client.listClusters({ region: 'ny4' });
```

## License

Apache-2.0
