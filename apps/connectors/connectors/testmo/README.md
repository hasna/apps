# Testmo Connector

TypeScript connector for the [Testmo](https://www.testmo.com/) test management platform REST API.

## Authentication

Bearer token authentication using an API key from your Testmo profile page.

| Variable | Description |
|----------|-------------|
| `TESTMO_API_KEY` | API key (required) |
| `TESTMO_BASE_URL` | Override base URL (default: `https://api.testmo.net/v1`) |

For named instances use `https://your-name.testmo.net/api/v1`.

## Commands

```bash
bun install
bun run dev runs list
bun run dev runs get <runId>
bun run dev runs create --body '{"project_id":1,"name":"Run"}'
bun run dev events list
bun run dev search --body '{"query":"login"}'
bun run dev raw --path /runs
```

## API

```typescript
import { Testmo } from '@hasna/connect-testmo';

const testmo = Testmo.fromEnv();
const runs = await testmo.listRuns({ page: 1, per_page: 25 });
```

## License

Apache-2.0
