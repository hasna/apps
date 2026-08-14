# @hasna/connect-synphony

A TypeScript connector and CLI for the [Synphony](https://synphony.ai) farm-robotics platform. Access farms, robots, telemetry, harvest runs, and bed analytics from code or the command line.

## Features

- Multi-profile configuration (switch between different API keys / deployments)
- Bearer token authentication with overridable base URL
- Automatic retries with exponential backoff on `429`/`5xx`
- Clean CLI built with Commander.js
- Pretty, table, and JSON output formats
- TypeScript with strict mode

## Install

```bash
bun install
```

## Configuration

The connector reads credentials from environment variables or a stored profile.

```bash
export SYNPHONY_API_KEY="your-api-key"
# Optional: override the API base URL
export SYNPHONY_BASE_URL="https://api.synphony.ai/v1"
```

Or store them in a profile:

```bash
bun run dev config set-key <your-api-key>
bun run dev config set-base-url https://api.synphony.ai/v1
```

See [`.env.example`](./.env.example) for all supported variables.

## CLI Usage

```bash
# Farms
connect-synphony farms list
connect-synphony farms list --query status=active
connect-synphony farms get <farmId>
connect-synphony farms bed-analytics <farmId> --query from=2026-01-01

# Robots
connect-synphony robots list
connect-synphony robots get <robotId>
connect-synphony robots telemetry <robotId> --query window=1h

# Harvest runs
connect-synphony harvest-runs list

# Raw escape hatch for any endpoint
connect-synphony raw /farms --query limit=10
connect-synphony raw /some/endpoint -X POST -d '{"key":"value"}'
```

Global flags: `--api-key`, `--base-url`, `--format <json|table|pretty>`, `--profile`, `--verbose`.

## Programmatic Usage

```ts
import { Connector } from '@hasna/connect-synphony';

const synphony = Connector.fromEnv(); // reads SYNPHONY_API_KEY / SYNPHONY_BASE_URL

const farms = await synphony.synphony.listFarms({ status: 'active' });
const robot = await synphony.synphony.getRobot('robot_123');
const telemetry = await synphony.synphony.getTelemetry('robot_123', { window: '1h' });
```

## Operations

| Method | Endpoint |
| --- | --- |
| `listFarms(params?)` | `GET /farms` |
| `getFarm(farmId)` | `GET /farms/{farmId}` |
| `listRobots(params?)` | `GET /robots` |
| `getRobot(robotId)` | `GET /robots/{robotId}` |
| `getTelemetry(robotId, params?)` | `GET /robots/{robotId}/telemetry` |
| `listHarvestRuns(params?)` | `GET /harvest-runs` |
| `getBedAnalytics(farmId, params?)` | `GET /farms/{farmId}/bed-analytics` |
| `rawRequest(params)` | any path/method |

## Development

```bash
bun run dev        # Run the CLI in development
bun run build      # Build for distribution
bun run typecheck  # Type check
bun test           # Run tests
```

## License

Apache-2.0
