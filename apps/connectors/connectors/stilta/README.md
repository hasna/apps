# connect-stilta

Stilta connector CLI - Patent search, research jobs, and prior-art analysis.

## Installation

```bash
bun install -g @hasna/connect-stilta
```

Or run from source:

```bash
bun install
bun run dev
```

## Quick Start

```bash
# Set your API key
connect-stilta config set-key YOUR_API_KEY

# Or use an environment variable
export STILTA_API_KEY=YOUR_API_KEY

# Search patents
connect-stilta patent search --query "wireless charging" --limit 10
```

## Authentication

connect-stilta uses API key authentication. The key is sent in the
`Authorization: Bearer <key>` header on every request.

Provide the key with either:

- Environment variable `STILTA_API_KEY`
- Profile config: `connect-stilta config set-key <key>`

The base URL defaults to `https://api.stilta.com/v1`. Override it with
`STILTA_BASE_URL` or `connect-stilta config set-base-url <url>`.

## Commands

### Patents

```bash
connect-stilta patent search --query "solar panel" --limit 20 --offset 0
connect-stilta patent search --body '{"query":"drone","filters":{"year":2023}}'
connect-stilta patent get US1234567B2
```

### Research Jobs

```bash
connect-stilta research-job list --status running --limit 10
connect-stilta research-job create --type prior-art --query "battery thermal management"
connect-stilta research-job get job_abc123
```

### Raw Requests

```bash
connect-stilta raw /patents/search -X POST --body '{"query":"antenna"}'
connect-stilta raw /research-jobs -q '{"limit":5}'
```

### Profiles & Config

```bash
connect-stilta profile create work --token sk-xxx --use
connect-stilta profile use work
connect-stilta -p personal patent search --query "graphene"

connect-stilta config set-key YOUR_API_KEY
connect-stilta config set-base-url https://api.stilta.com/v1
connect-stilta config show
connect-stilta config clear
```

## Global Options

| Option | Description |
|--------|-------------|
| `-t, --token <token>` | API key (overrides config) |
| `-b, --base-url <url>` | API base URL (overrides config) |
| `-f, --format <format>` | Output format: `json`, `table`, `pretty` (default `pretty`) |
| `-p, --profile <profile>` | Use a specific profile |

## Library Usage

```typescript
import { Stilta } from '@hasna/connect-stilta';

const stilta = Stilta.fromEnv(); // reads STILTA_API_KEY / STILTA_BASE_URL

const results = await stilta.searchPatents({ query: 'wireless charging', limit: 10 });
const patent = await stilta.getPatent('US1234567B2');
const job = await stilta.createResearchJob({ type: 'prior-art', query: 'antenna array' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STILTA_API_KEY` | Stilta API key (overrides profile config) |
| `STILTA_BASE_URL` | Override the API base URL (optional) |

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## License

Apache-2.0
