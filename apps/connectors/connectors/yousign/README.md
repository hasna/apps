# Yousign Connector

TypeScript connector for the [Yousign API v3](https://developers.yousign.com/) — electronic signatures, templates, webhooks, and document workflows.

## Install

```bash
bun install
```

## Usage

### CLI

```bash
bun run dev config set-key <your-api-key>
bun run dev config set-environment sandbox
bun run dev request list --format json
```

### Library

```typescript
import { Yousign } from '@hasna/connect-yousign';

const client = new Yousign({
  apiKey: process.env.YOUSIGN_API_KEY!,
  environment: 'sandbox',
});

const requests = await client.listSignatureRequests({ limit: 10 });
```

## Development

```bash
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
