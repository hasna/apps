# @hasna/connect-stitch-data

A TypeScript connector CLI and SDK for [Stitch](https://www.stitchdata.com) via the
[Stitch Connect API](https://www.stitchdata.com/docs/developers/stitch-connect/api).

Manage data sources, destinations, streams, and replication jobs, and monitor
extraction and load activity from the command line or programmatically.

## Features

- Bearer token authentication against the Stitch Connect API (v4)
- Sources: list, get, create, update, delete, pause, unpause, connection check
- Destinations: list, create, update, delete
- Source / destination type catalog browsing
- Streams: list and inspect a source's streams
- Replication jobs: start and stop syncs
- Reporting: paginated extractions and loads, extraction job logs
- Automatic retry with backoff on rate limits (429) and transient 5xx errors
- Multi-profile configuration, pretty / table / JSON output

## Installation

```bash
bun install
bun run build
```

## Authentication

Create a non-expiring API access token from the Stitch dashboard
(Account settings → API access), then provide it via any of:

```bash
# Environment variable
export STITCH_ACCESS_TOKEN=your_access_token
# Optional: needed only for reporting (extractions/loads) endpoints
export STITCH_CLIENT_ID=1234

# Or store it in a profile
bun run dev config set --token your_access_token --client-id 1234

# Or pass per-invocation
bun run dev --api-key your_access_token sources list
```

See `.env.example` for all supported variables.

## Usage

```bash
# Sources
bun run dev sources list
bun run dev sources get 12345
bun run dev sources create --type platform.hubspot --name "HubSpot" --properties '{"start_date":"2024-01-01T00:00:00Z"}'
bun run dev sources pause 12345
bun run dev sources unpause 12345
bun run dev sources check 12345

# Streams
bun run dev streams list 12345
bun run dev streams get 12345 67890

# Replication jobs
bun run dev sync start 12345
bun run dev sync stop 12345

# Destinations
bun run dev destinations list

# Catalog
bun run dev source-types list
bun run dev destination-types list

# Reporting (requires a client id)
bun run dev extractions list --page 1
bun run dev extractions log <job-name>
bun run dev loads list
```

Global options: `--api-key`, `--client-id`, `--base-url`, `--format <json|table|pretty>`,
`--verbose`, `--profile <name>`.

## Programmatic usage

```ts
import { Stitch } from '@hasna/connect-stitch-data';

const stitch = Stitch.fromEnv();
const sources = await stitch.sources.list();
await stitch.replication.start(sources[0].id);
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
