# @hasna/connect-the-hive-project

TypeScript connector for real [TheHive](https://thehive-project.org/) instance APIs documented by StrangeBee.

This package uses the distinct registry slug `the-hive-project` and npm package `@hasna/connect-the-hive-project`. Existing `thehive` and `thehive5` entries in this repository are legacy scaffold packages; this connector is the concrete TheHive 5 API implementation.

## Installation

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI profile:

```bash
export THE_HIVE_PROJECT_API_KEY=your-api-key
export THE_HIVE_PROJECT_BASE_URL=https://thehive.example
# optional, when targeting a non-default organisation
export THE_HIVE_PROJECT_ORGANISATION=example-org
```

Or use the CLI:

```bash
bun run dev config set-key your-api-key
bun run dev config set-base-url https://thehive.example
```

`THE_HIVE_PROJECT_BASE_URL` is the root URL of your TheHive instance. The connector appends `/api/v1` internally. A value that already ends in `/api/v1` is accepted and normalized to the instance root.

## Usage

### CLI

```bash
bun run dev cases list
bun run dev cases get <caseId>
bun run dev cases create --title "Security incident"
bun run dev query run --body '{"query":[{"_name":"listCase"}]}'
bun run dev events create <caseId> --body '{"title":"Timeline note"}'
```

### Library

```typescript
import { TheHiveProject } from '@hasna/connect-the-hive-project';

const client = TheHiveProject.fromEnv();
const cases = await client.cases.list();
const status = await client.rawRequest({ path: '/status' });
```

## API Surface

- `POST /api/v1/query` — run TheHive queries, including case listing
- `POST /api/v1/case` — create case
- `GET /api/v1/case/{idOrName}` — get case
- `POST /api/v1/case/{caseId}/customEvent` — create custom timeline event
- `PATCH /api/v1/customEvent/{eventId}` — update custom timeline event
- `DELETE /api/v1/customEvent/{eventId}` — delete custom timeline event
- `rawRequest()` — arbitrary authenticated request

## License

Apache-2.0
