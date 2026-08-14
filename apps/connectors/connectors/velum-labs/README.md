# connect-velum-labs

TypeScript CLI and library for the [Velum Labs](https://velum-labs.com) data lab platform API.

## Features

- Dataset management (list, create, get)
- Event listing
- Cross-dataset search
- Raw HTTP request support
- Multi-profile configuration
- JSON and pretty output formats

## Quick Start

```bash
bun install
export VELUM_LABS_API_KEY=your-api-key
bun run dev datasets list
```

## CLI Usage

```bash
# Configure API key
connect-velum-labs config set-key <api-key>

# List datasets
connect-velum-labs datasets list

# Get a dataset
connect-velum-labs datasets get <dataset-id>

# Create a dataset
connect-velum-labs datasets create --name "My Dataset"

# List events
connect-velum-labs events --limit 20

# Search
connect-velum-labs search "keyword" --dataset-id <id>

# Raw API request
connect-velum-labs raw-request --path /datasets -X GET
```

## Library Usage

```typescript
import { VelumLabs } from '@hasna/connect-velum-labs';

const client = VelumLabs.fromEnv();
const datasets = await client.listDatasets();
const results = await client.search({ query: 'example' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VELUM_LABS_API_KEY` | API key |
| `VELUM_LABS_BASE_URL` | Optional base URL override |

## License

Apache-2.0
