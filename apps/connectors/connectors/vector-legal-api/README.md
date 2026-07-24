# connect-vector-legal-api

TypeScript connector for the [Vector Legal API](https://api.vector-legal.com/v1) — legal document management, events, and search.

## Features

- Bearer API key authentication with optional base URL override
- Multi-profile configuration
- Documents, events, and search API resources
- Raw API request command for advanced usage
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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VECTOR_LEGAL_API_KEY` | Yes | API key |
| `VECTOR_LEGAL_API_BASE_URL` | No | Base URL (default: `https://api.vector-legal.com/v1`) |

## CLI

```bash
connect-vector-legal-api documents list
connect-vector-legal-api documents get <id>
connect-vector-legal-api documents create --body '{"title":"Contract"}'
connect-vector-legal-api events list
connect-vector-legal-api search --body '{"query":"nda"}'
connect-vector-legal-api raw GET /documents
```

## License

Apache-2.0
