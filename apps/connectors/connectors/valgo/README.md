# connect-valgo

TypeScript connector for the [Valgo API](https://api.valgo.ai/v1) — physical AI risk quantification and autonomy insurance simulations.

## Features

- Bearer token authentication with multi-profile configuration
- Simulations, routes, environments, and raw request escape hatch
- CLI and programmatic library API
- JSON and pretty output formats

## Quick Start

```bash
bun install
export VALGO_API_KEY=your-api-key-here
bun run dev list-simulations
```

## CLI Commands

```bash
connect-valgo list-simulations [--query '{"limit":10}']
connect-valgo get-simulation <simulationId>
connect-valgo create-simulation --data '{"name":"fleet-risk"}'
connect-valgo get-loss-estimate <simulationId>
connect-valgo list-routes
connect-valgo get-route <routeId>
connect-valgo list-environments
connect-valgo raw-request --method GET --path /simulations
connect-valgo config set-key <key>
connect-valgo profile list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VALGO_API_KEY` | API key |
| `VALGO_BASE_URL` | Optional base URL (default `https://api.valgo.ai/v1`) |

## Library Usage

```typescript
import { Connector } from '@hasna/connect-valgo';

const client = new Connector({ apiKey: process.env.VALGO_API_KEY! });
const simulations = await client.simulations.list();
```

## License

Apache-2.0
