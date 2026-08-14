# @hasna/connect-surtrdefensesystems

Connector for **Surtr Defense Systems** — a counter-UAS (C-UAS) operating system.
It exposes sensors, fused threat tracks, the live situation picture, and engagement
workflows through a TypeScript library and a CLI.

## Features

- Bearer API-key authentication
- Sensors: list and inspect
- Threats: list and inspect fused tracks
- Situation picture: fetch the current fused air picture
- Engagements: list engagements and request an engagement recommendation
- Raw request escape hatch for any API path
- Multi-profile configuration (switch between API keys / environments)
- Pretty, table, and JSON output formats

## Installation

```bash
bun install
```

## Configuration

Provide an API key via environment variable or profile config:

```bash
export SURTRDEFENSESYSTEMS_API_KEY="your-api-key"
# optional, defaults to https://api.surtrdefense.com/v1
export SURTRDEFENSESYSTEMS_BASE_URL="https://api.surtrdefense.com/v1"
```

Or store it in a profile:

```bash
connect-surtrdefensesystems config set-key your-api-key
connect-surtrdefensesystems config set-base-url https://api.surtrdefense.com/v1
```

See `.env.example` for the full list of variables.

## CLI Usage

```bash
connect-surtrdefensesystems [options] [command]

Options:
  -k, --api-key <key>      API key (overrides config)
  -u, --base-url <url>     API base URL (overrides config)
  -f, --format <format>    Output format (json, table, pretty)
  -p, --profile <profile>  Use a specific profile

Commands:
  sensor list              List sensors
  sensor get <sensorId>    Get a sensor by ID
  threat list              List threats
  threat get <threatId>    Get a threat by ID
  situation get            Get the current fused situation picture
  engagement list          List engagements
  engagement recommend     Request an engagement recommendation for a threat
  raw <path>               Make a raw authenticated request to any API path

  profile list|use|create|delete|show   Manage configuration profiles
  config set-key|set-base-url|show|clear Manage active-profile configuration
```

### Examples

```bash
# List online radar sensors
connect-surtrdefensesystems sensor list --status online --type radar

# Inspect a threat track as JSON
connect-surtrdefensesystems -f json threat get thr_12345

# Current situation picture
connect-surtrdefensesystems situation get

# Ask for an engagement recommendation
connect-surtrdefensesystems engagement recommend --threat thr_12345 --method rf-jam
```

## Library Usage

```typescript
import { Surtr } from '@hasna/connect-surtrdefensesystems';

const surtr = new Surtr({ apiKey: process.env.SURTRDEFENSESYSTEMS_API_KEY! });

const sensors = await surtr.listSensors({ status: 'online' });
const picture = await surtr.getSituationPicture();
const rec = await surtr.createEngagementRecommendation({ threat_id: 'thr_12345' });
```

## Development

```bash
bun install
bun run dev            # run the CLI
bun run typecheck      # type check
bun test               # run tests
bun run build          # build dist/ and bin/
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SURTRDEFENSESYSTEMS_API_KEY` | API key (overrides profile config) |
| `SURTRDEFENSESYSTEMS_BASE_URL` | Override API base URL (optional) |

## License

Apache-2.0
