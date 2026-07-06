# @hasna/connect-the-hive-project

TypeScript connector for the [TheHiveProject](https://thehive-project.org/) security case management API.

## Installation

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI profile:

```bash
export THE_HIVE_PROJECT_API_KEY=your-api-key
# optional
export THE_HIVE_PROJECT_BASE_URL=https://api.thehive-project.com/v1
```

Or use the CLI:

```bash
bun run dev config set-key your-api-key
```

## Usage

### CLI

```bash
bun run dev cases list
bun run dev cases get <caseId>
bun run dev cases create --title "Security incident"
bun run dev events list
bun run dev search run --body '{"query":{}}'
```

### Library

```typescript
import { TheHiveProject } from '@hasna/connect-the-hive-project';

const client = TheHiveProject.fromEnv();
const cases = await client.cases.list();
```

## API Surface

- `GET /cases` — list cases
- `POST /cases` — create case
- `GET /cases/{id}` — get case
- `GET /events` — list events
- `POST /search` — search
- `rawRequest()` — arbitrary authenticated request

## License

Apache-2.0
