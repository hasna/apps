# Upstash Connector

TypeScript connector for the [Upstash Developer API](https://upstash.com/docs/devops/developer-api/introduction) — manage serverless Redis databases and Kafka topics via the control plane at `https://api.upstash.com/v2`.

## Authentication

Upstash uses HTTP Basic authentication with your account email and API key:

1. Sign in at [console.upstash.com](https://console.upstash.com)
2. Go to **Account → API Keys**
3. Copy your email and API key

```bash
export UPSTASH_EMAIL=your-email@example.com
export UPSTASH_API_KEY=your-api-key
```

Or configure via CLI:

```bash
bun run dev config setup --email your-email@example.com --api-key your-api-key
```

## Commands

```bash
# Redis databases
bun run dev databases list
bun run dev databases get <database-id>
bun run dev databases create --name my-redis --region us-east-1

# Database stats
bun run dev stats get <database-id>

# Kafka topics
bun run dev topics list
```

## Library Usage

```typescript
import { Upstash } from '@hasna/connect-upstash';

const upstash = Upstash.fromEnv();
const databases = await upstash.listDatabases();
const stats = await upstash.getStats('database-id');
const topics = await upstash.listTopics();
```

Database passwords are always redacted in API responses.

## Development

```bash
bun install
bun run dev databases list
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
