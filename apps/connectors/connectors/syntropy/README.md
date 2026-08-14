# connect-syntropy

Syntropy API connector CLI — a TypeScript wrapper for the [Syntropy](https://syntropy.io/) agentic coding platform. Drive spec-driven builds, inspect pull requests and tasks, and reach any endpoint via raw API access.

## Installation

```bash
bun install -g @hasna/connect-syntropy
```

## Quick Start

```bash
# Set your API key
connect-syntropy config set-key YOUR_API_KEY

# Or use environment variables
export SYNTROPY_API_KEY=YOUR_API_KEY
# Optional base URL override (defaults to https://api.syntropy.io/v1)
export SYNTROPY_BASE_URL=https://api.syntropy.io/v1
```

## Authentication

Syntropy uses a Bearer API key. Requests send `Authorization: Bearer <api_key>`.
Configure it once via `config set-key`, per-profile, or per-invocation with `--api-key`.

## CLI Commands

```bash
# Profile management
connect-syntropy profile list
connect-syntropy profile create <name> --api-key <key> --base-url <url> --use
connect-syntropy profile use <name>
connect-syntropy profile show [name]
connect-syntropy profile delete <name>

# Configuration (applies to the active profile)
connect-syntropy config set-key <api-key>
connect-syntropy config set-base-url <url>
connect-syntropy config show
connect-syntropy config clear

# Specs
connect-syntropy list-specs
connect-syntropy get-spec <specId>
connect-syntropy create-spec "Add OAuth login" --prompt "Support Google SSO" --repository owner/repo

# Builds
connect-syntropy list-builds
connect-syntropy get-build <buildId>
connect-syntropy start-build <specId>

# Pull requests & tasks
connect-syntropy list-pull-requests
connect-syntropy list-tasks

# Raw API access (escape hatch for any endpoint)
connect-syntropy raw /specs
connect-syntropy raw /builds -X POST -d '{"spec_id":"spec_123"}'
connect-syntropy raw /specs -q status=ready -q limit=10
```

### Global options

- `-k, --api-key <key>` — override the configured API key
- `-b, --base-url <url>` — override the API base URL
- `-f, --format <format>` — `pretty` (default), `json`, or `table`
- `-p, --profile <profile>` — use a specific profile

## Programmatic Usage

```ts
import { Connector } from '@hasna/connect-syntropy';

const syntropy = Connector.fromEnv(); // reads SYNTROPY_API_KEY (+ optional SYNTROPY_BASE_URL)

const { specs } = await syntropy.specs.list();
const created = await syntropy.specs.create({ title: 'Add OAuth login', prompt: 'Support SSO' });
const build = await syntropy.builds.start(created.spec.id);
const { pull_requests } = await syntropy.pullRequests.list();

// Raw access to any endpoint
const res = await syntropy.raw.request({ method: 'GET', path: '/tasks' });
```

## Offline / unreachable behavior

Read operations return placeholder (`stub: true`) data when the API is unreachable
so the CLI stays usable offline; HTTP errors (401/403/5xx) surface as
`ConnectorApiError`. The `raw` command reports the HTTP status/body instead of
throwing, so you can inspect error responses directly.

## Development

```bash
bun install
bun run dev            # run the CLI from source
bun test               # run the test suite
bun run typecheck      # type-check
bun run build          # build dist/ + bin/
```

## License

Apache-2.0
