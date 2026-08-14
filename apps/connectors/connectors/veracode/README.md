# @hasna/connect-veracode

TypeScript connector for the [Veracode REST API](https://docs.veracode.com/) — application security scanning, events, and search.

## Install

```bash
bun install
```

## Configuration

Copy `.env.example` and set your API key:

```bash
VERACODE_API_KEY=[REDACTED]
# optional
VERACODE_BASE_URL=https://api.veracode.com/v1
```

Profiles are stored under `~/.hasna/connectors/veracode/profiles/`.

## CLI

```bash
bun run dev scan list
bun run dev scan get <scanId>
bun run dev scan create --body '{"name":"example"}'
bun run dev events list
bun run dev search run --body '{"query":"flaw"}'
bun run dev config set-key <api-key>
```

## Library

```typescript
import { Veracode } from '@hasna/connect-veracode';

const client = Veracode.fromEnv();
const scans = await client.listScans();
```

## Development

```bash
bun test
bun run typecheck
bun run build
```

## License

Apache-2.0
