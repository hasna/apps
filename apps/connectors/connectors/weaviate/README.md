# connect-weaviate

TypeScript CLI and library for self-hosted [Weaviate](https://weaviate.io/) vector database instances.

## Features

- Schema management (get, create, delete classes)
- Object CRUD operations
- GraphQL queries and near-text semantic search
- Cluster node status
- Multi-profile configuration with host + optional Bearer API key

## Quick Start

```bash
bun install
bun run dev config set-host https://your-weaviate.example.com
bun run dev config set-key your-api-key
bun run dev schema get
```

## CLI Commands

```bash
connect-weaviate schema get|create|delete
connect-weaviate objects add|get|update|delete
connect-weaviate graphql query -q '{ ... }'
connect-weaviate search near-text -c Article --concepts '["machine learning"]'
connect-weaviate nodes get
connect-weaviate config set-host|set-key|show|clear
connect-weaviate profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEAVIATE_HOST` | Weaviate instance URL (required) |
| `WEAVIATE_API_KEY` | Optional Bearer API key |

## Library Usage

```typescript
import { Weaviate } from '@hasna/connect-weaviate';

const client = new Weaviate({
  host: 'https://your-weaviate.example.com',
  apiKey: 'optional-key',
});

const schema = await client.getSchema();
```

## License

Apache-2.0
