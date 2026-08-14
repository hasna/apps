# connect-vector-legal

TypeScript connector for the [Vector Legal](https://vector-legal.com) API — legal document platform with documents, events, and search.

## Features

- Bearer token authentication with optional base URL override
- Multi-profile configuration
- Documents, events, search, and raw request APIs
- CLI and programmatic library access
- Pretty and JSON output formats

## Quick Start

```bash
bun install
export VECTOR_LEGAL_API_KEY=your-api-key
bun run dev documents list
```

Or configure a profile:

```bash
bun run dev config set-key your-api-key
bun run dev documents list
```

## CLI

```bash
connect-vector-legal documents list
connect-vector-legal documents get <id>
connect-vector-legal documents create --title "Contract" --body '{"type":"contract"}'
connect-vector-legal events list
connect-vector-legal search --query "agreement"
connect-vector-legal raw --method GET --path /documents
```

## Library

```typescript
import { Connector } from '@hasna/connect-vector-legal';

const client = Connector.fromEnv();
const docs = await client.documents.list();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VECTOR_LEGAL_API_KEY` | API key |
| `VECTOR_LEGAL_BASE_URL` | Optional base URL (default `https://api.vector-legal.com/v1`) |

## License

Apache-2.0
