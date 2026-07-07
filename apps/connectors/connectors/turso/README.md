# @hasna/connect-turso

TypeScript connector for the [Turso Platform API](https://docs.turso.tech/api-reference/introduction).

## Features

- Bearer token authentication with organization slug scoping
- Multi-profile configuration
- CLI for organizations, databases, groups, and usage
- Thin fetch-based HTTP client with retry on rate limits and 5xx errors
- TypeScript types for core API resources

## Quick Start

```bash
cd connectors/turso
bun install

# Configure credentials
bun run dev config set-key <your-platform-token>
bun run dev config set-org <your-org-slug>

# List databases
bun run dev database list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURSO_API_TOKEN` | Platform API token |
| `TURSO_ORGANIZATION` | Organization slug |

Copy `.env.example` to `.env` and fill in placeholders for local development.

## Programmatic Usage

```typescript
import { Turso } from '@hasna/connect-turso';

const turso = new Turso({
  apiKey: process.env.TURSO_API_TOKEN!,
  organization: process.env.TURSO_ORGANIZATION!,
});

const { databases } = await turso.listDatabases();
const created = await turso.createDatabase({ name: 'agent-1', group: 'default' });
```

## License

Apache-2.0
