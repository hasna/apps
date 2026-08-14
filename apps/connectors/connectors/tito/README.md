# @hasna/connect-tito

TypeScript connector for the [Tito (ti.to) Admin REST API v3](https://ti.to/docs/api/admin/3.1).

## Install

```bash
bun install
```

## Configure

```bash
export TITO_API_TOKEN=your-api-token
# or
bun run dev config set-key your-api-token
```

## Usage

```bash
bun run dev hello
bun run dev tickets list --account my-org --event my-event
bun run dev registrations get abc123 --account my-org --event my-event
bun run dev releases list --account my-org --event my-event
bun run dev checkin-lists list --account my-org --event my-event
```

## Library

```typescript
import { Tito } from '@hasna/connect-tito';

const tito = Tito.fromEnv();
await tito.hello();
await tito.listTickets({ accountSlug: 'my-org', eventSlug: 'my-event' });
```

## License

Apache-2.0
