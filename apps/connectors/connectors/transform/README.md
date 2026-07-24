# Transform Connector

TypeScript connector for the [Transform](https://transform.com) data transform platform API.

## Features

- Bearer token (`api_key`) authentication
- Pipeline management (list, create, get)
- Event listing
- Search API
- Raw request escape hatch for custom endpoints
- Multi-profile configuration

## Installation

```bash
bun install
bun run build
```

## Authentication

Bearer token authentication via API key:

```bash
export TRANSFORM_API_KEY=your-api-key-here
# or
connect-transform config set-key your-api-key-here
```

Optional base URL override:

```bash
export TRANSFORM_BASE_URL=https://api.transform.com/v1
```

## CLI Usage

```bash
# Pipelines
connect-transform pipelines list
connect-transform pipelines get <pipelineId>
connect-transform pipelines create --name "My Pipeline"

# Events
connect-transform events list --pipeline-id <id>

# Search
connect-transform search query --query "status:running"

# Raw request
connect-transform raw request -m GET -p /pipelines
connect-transform raw request -m POST -p /search --body '{"query":"test"}'
```

## Library Usage

```typescript
import { Transform } from '@hasna/connect-transform';

const client = Transform.fromEnv();
const pipelines = await client.pipelines.list();
const results = await client.search.search({ query: 'pipeline' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRANSFORM_API_KEY` | API key (overrides profile) |
| `TRANSFORM_BASE_URL` | Override API base URL |

## License

Apache-2.0
