# @hasna/connect-tinybird

TypeScript connector for the [Tinybird](https://www.tinybird.co/) real-time analytics API.

## Features

- SQL queries (`/v0/sql`)
- Pipes CRUD, nodes, explain, and parameterized queries
- Datasources CRUD, alter, truncate, ingest
- NDJSON event ingestion (`/v0/events`)
- Workspace token management
- Background jobs list/get/cancel

## Install

```bash
bun install
```

## Configuration

Set your workspace API token (from Tinybird UI → Tokens):

```bash
export TINYBIRD_API_TOKEN=your-token
# or
bun run dev config set-key your-token
```

Optional custom host:

```bash
export TINYBIRD_HOST=https://api.tinybird.co
```

## Usage

```bash
# SQL
bun run dev sql query "SELECT 1"

# Pipes
bun run dev pipes list
bun run dev pipes query my_pipe

# Datasources
bun run dev datasources list

# Events (NDJSON)
bun run dev events ingest my_ds '{"event":"click"}'

# Tokens & jobs
bun run dev tokens list
bun run dev jobs list
```

## Library

```typescript
import { Tinybird } from '@hasna/connect-tinybird';

const tb = Tinybird.fromEnv();
const rows = await tb.sql.query({ q: 'SELECT 1' });
```

## License

Apache-2.0
