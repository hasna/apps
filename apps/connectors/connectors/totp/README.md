# @hasna/connect-totp

TypeScript connector for the [Totp](https://www.ycombinator.com/companies/totp) API — manage TOTP codes, events, and search.

## Features

- Bearer API key authentication
- Multi-profile CLI configuration
- Library exports for programmatic use
- Commands: codes list/create/get, events list, search, raw-request

## Install

```bash
bun install
```

## Configuration

```bash
export TOTP_API_KEY=your-api-key
# optional
export TOTP_BASE_URL=https://api.totp.com/v1
```

Or via CLI:

```bash
bun run dev config set-key your-api-key
bun run dev config set-base-url https://api.totp.com/v1
```

## CLI Usage

```bash
bun run dev codes list
bun run dev codes get <codeId>
bun run dev codes create --body '{"name":"My App"}'
bun run dev events list
bun run dev search --body '{"query":"login"}'
bun run dev raw-request --path /codes -X GET
```

## Library Usage

```typescript
import { Totp } from '@hasna/connect-totp';

const totp = Totp.fromEnv();
const codes = await totp.listCodes();
const code = await totp.getCode('item-1');
```

## Development

```bash
bun install
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
