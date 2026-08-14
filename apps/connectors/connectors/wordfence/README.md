# @hasna/connect-wordfence

TypeScript connector and CLI for the Wordfence security API.

## Features

- Bearer token authentication
- Security scan management (list, create, get)
- Security event monitoring
- Search API
- Multi-profile configuration
- JSON and pretty CLI output

## Installation

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI profile:

```bash
export WORDFENCE_API_KEY=your-api-key-here
# or
connect-wordfence config set-key your-api-key-here
```

Copy `.env.example` to `.env` for local development (placeholders only).

## Usage

### CLI

```bash
bun run dev scans list
bun run dev scans create --site-id site-123 --type full
bun run dev scans get scan-abc
bun run dev events list --type login --since 2026-01-01
bun run dev search "malware" --type issue
```

### Library

```typescript
import { Connector } from '@hasna/connect-wordfence';

const wordfence = Connector.fromEnv();
const scans = await wordfence.scans.list({ limit: 10 });
const events = await wordfence.events.list({ type: 'login' });
const results = await wordfence.search.search({ query: 'malware' });
```

## API Base URL

Default: `https://api.wordfence.com/v1`

Override with `WORDFENCE_BASE_URL` or `connect-wordfence config set-base-url`.

## License

Apache-2.0
