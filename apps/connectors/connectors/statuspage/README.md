# connect-statuspage

TypeScript connector for the [Atlassian Statuspage](https://www.atlassian.com/software/statuspage) Manage API.

## Features

- Multi-profile configuration
- Pages, incidents, and components API coverage
- Pretty and JSON output formats
- CLI built with Commander.js

## Quick Start

```bash
bun install
bun run dev config set-api-key YOUR_API_KEY
bun run dev config set-page-id YOUR_PAGE_ID
bun run dev validate
bun run dev pages list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STATUSPAGE_API_KEY` | Organization API key |
| `STATUSPAGE_PAGE_ID` | Default page ID |

Copy `.env.example` to `.env` for local development (placeholders only).

## CLI

```bash
connect-statuspage pages list
connect-statuspage incidents list
connect-statuspage incidents create --name "Database outage" --status investigating
connect-statuspage components list
connect-statuspage validate
```

Page-scoped commands accept an optional `[page_id]` argument, a global `--page-id` flag, or a profile default via `config set-page-id`.

## Library Usage

```typescript
import { Statuspage } from '@hasna/connect-statuspage';

const client = Statuspage.fromEnv();
const pages = await client.listPages();
const incidents = await client.listIncidents('your-page-id');
```

## API Documentation

https://developer.statuspage.io/

## License

Apache-2.0
