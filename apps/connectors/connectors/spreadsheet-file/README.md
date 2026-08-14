# connect-spreadsheet-file

TypeScript connector for the [SpreadsheetFile API](https://api.spreadsheet-file.com/v1) — spreadsheet workflow node operations.

## Features

- List, create, and retrieve spreadsheet files
- List workflow events
- Search spreadsheet data
- Raw API request support
- Multi-profile configuration
- Bearer token authentication
- CLI and library exports

## Installation

```bash
bun install
bun run build
```

## Configuration

Set credentials via environment variables or CLI profile:

```bash
export SPREADSHEET_FILE_API_KEY=your-api-key
# optional
export SPREADSHEET_FILE_BASE_URL=https://api.spreadsheet-file.com/v1
```

Or use the CLI:

```bash
bun run dev config set-key <api-key>
bun run dev config show
```

Profiles are stored in `~/.hasna/connectors/connect-spreadsheet-file/`.

## CLI Usage

```bash
# Files
bun run dev files list
bun run dev files get <fileId>
bun run dev files create --name "My file"
bun run dev files create --body '{"name":"My file"}'

# Events
bun run dev events list
bun run dev events list --file-id <fileId>

# Search
bun run dev search run --query "example"
bun run dev search run --body '{"query":"example"}'

# Raw request
bun run dev raw --path /files --method GET
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-spreadsheet-file';

const client = Connector.fromEnv();
const files = await client.files.list();
const file = await client.files.get('file-id');
```

## API

- Base URL: `https://api.spreadsheet-file.com/v1`
- Auth: `Authorization: Bearer <api_key>`

## License

Apache-2.0
