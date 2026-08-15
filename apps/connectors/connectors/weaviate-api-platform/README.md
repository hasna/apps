# @hasna/connect-weaviate-api-platform

TypeScript connector and CLI for the Weaviate API Platform.

## Install

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set your API key:

```bash
WEAVIATE_API_PLATFORM_API_KEY=your-api-key-here
```

Or use the CLI profile system:

```bash
bun run dev config set-key your-api-key-here
```

## Usage

```bash
bun run dev items list
bun run dev items get my-item-id
bun run dev search -b '{"query":"hello"}'
bun run dev events list
```

## Library

```typescript
import { Connector } from '@hasna/connect-weaviate-api-platform';

const client = Connector.fromEnv();
const items = await client.listItems();
const results = await client.search({ query: 'hello' });
```

## License

Apache-2.0
