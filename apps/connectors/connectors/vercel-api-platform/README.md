# @hasna/connect-vercel-api-platform

TypeScript connector and CLI for the [Vercel Api Platform](https://api.vercelapiplatform.com/v1) REST API.

> **Note:** This is distinct from `@hasna/connect-vercel`, which targets `api.vercel.com` for Vercel deployments.

## Install

```bash
bun add @hasna/connect-vercel-api-platform
```

## Configuration

```bash
export VERCEL_API_PLATFORM_API_KEY=your-api-key
# optional
export VERCEL_API_PLATFORM_BASE_URL=https://api.vercelapiplatform.com/v1
```

Or use the CLI profile/config commands.

## CLI Usage

```bash
connect-vercel-api-platform items list
connect-vercel-api-platform items create -d '{"name":"my-item"}'
connect-vercel-api-platform items get <itemId>
connect-vercel-api-platform events list
connect-vercel-api-platform search -d '{"query":"deploy"}'
connect-vercel-api-platform raw-request --path /items -m GET
```

## Programmatic Usage

```typescript
import { Connector } from '@hasna/connect-vercel-api-platform';

const client = Connector.fromEnv();
const items = await client.items.list();
const created = await client.items.create({ name: 'example' });
const events = await client.events.list();
const results = await client.search.search({ query: 'deploy' });
```

## License

Apache-2.0
