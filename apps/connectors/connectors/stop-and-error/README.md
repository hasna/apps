# @hasna/connect-stop-and-error

TypeScript connector for the StopAndError workflow error handler API.

## Install

```bash
bun install
```

## Configuration

Set credentials via environment variables or CLI profile:

```bash
export STOP_AND_ERROR_API_KEY=your-api-key
# optional
export STOP_AND_ERROR_BASE_URL=https://api.stop-and-error.com/v1
```

Or use the CLI:

```bash
bun run dev config set-key <api-key>
bun run dev status
```

## CLI

```bash
bun run dev errors list
bun run dev errors get <id>
bun run dev errors create --message "workflow halted" --code HALT
bun run dev events list --error-id <id>
bun run dev search --query "timeout"
bun run dev raw --path /errors --method GET
```

## Library

```typescript
import { StopAndError } from '@hasna/connect-stop-and-error';

const client = StopAndError.fromEnv();
const errors = await client.listErrors({ limit: 10 });
```

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
