# Tines Connector

TypeScript connector for the [Tines](https://www.tines.com/) SOAR platform API.

## Features

- Bearer token authentication with tenant URL
- Stories, agents, events, folders, teams, users, tunnels, credentials
- Story runs, annotations, and webhook delivery
- Multi-profile CLI configuration

## Installation

```bash
bun install
```

## Configuration

```bash
export TINES_API_KEY=your-api-key
export TINES_TENANT_URL=https://your-tenant.tines.com

# Or via CLI profile
connect-tines config set --api-key <key> --tenant-url https://your-tenant.tines.com
```

## CLI Usage

```bash
connect-tines stories list --team-id 1
connect-tines agents run 42 --payload '{"alert":"test"}'
connect-tines webhook send my-path my-secret --payload '{"foo":"bar"}'
connect-tines teams list
```

## Library Usage

```typescript
import { Tines } from '@hasna/connect-tines';

const tines = Tines.fromEnv();
const stories = await tines.stories.list({ teamId: 1 });
```

## Development

```bash
bun run dev stories list
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
