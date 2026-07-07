# connect-sprinklr

TypeScript connector for the Sprinklr customer experience platform API.

## Features

- Bearer token authentication with API key
- Cases: list, get, create
- Events: list
- Search across Sprinklr data
- Raw request escape hatch
- Multi-profile configuration
- CLI and library exports

## Quick Start

```bash
bun install
bun run dev config set-key your-api-key
bun run dev cases list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPRINKLR_API_KEY` | API key (overrides profile) |
| `SPRINKLR_BASE_URL` | API base URL (default: `https://api.sprinklr.com/v1`) |

## CLI Commands

```bash
connect-sprinklr cases list
connect-sprinklr cases get <caseId>
connect-sprinklr cases create --body '{"subject":"Support"}'
connect-sprinklr events list
connect-sprinklr search --query "billing"
connect-sprinklr raw --path /cases --method GET
connect-sprinklr profile list
connect-sprinklr config show
```

## Library Usage

```typescript
import { Sprinklr } from '@hasna/connect-sprinklr';

const sprinklr = new Sprinklr({
  apiKey: process.env.SPRINKLR_API_KEY!,
});

const cases = await sprinklr.listCases();
const created = await sprinklr.createCase({ subject: 'New case' });
```

## License

Apache-2.0
