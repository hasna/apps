# @hasna/connect-trycardinal-ai

TypeScript connector for the [Cardinal](https://trycardinal.ai) document intelligence API.

## Features

- Convert documents to markdown (`POST /markdown`)
- Split documents into sections (`POST /split`)
- Generic raw API requests
- Multi-profile configuration
- CLI and programmatic library API

## Installation

```bash
bun add @hasna/connect-trycardinal-ai
```

Or use via the `@hasna/connectors` monorepo installer.

## Authentication

Set your API key via environment variable or CLI config:

```bash
export TRYCARDINAL_AI_API_KEY=your-api-key
# or
connect-trycardinal-ai config set-key your-api-key
```

See [Cardinal authentication docs](https://docs.trycardinal.ai/authentication).

## CLI Usage

```bash
# Convert a remote document to markdown
connect-trycardinal-ai convert-to-markdown --file-url https://example.com/doc.pdf

# Convert a local file
connect-trycardinal-ai convert-to-markdown --file ./document.pdf --pages 2

# Split a document
connect-trycardinal-ai split-document --file-url https://example.com/doc.pdf --mode sections

# Raw API request
connect-trycardinal-ai raw-request --path /markdown --method POST --body '{"fileUrl":"https://example.com/doc.pdf"}'
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-trycardinal-ai';

const client = Connector.fromEnv();
const result = await client.documents.convertToMarkdown({ fileUrl: 'https://example.com/doc.pdf' });
```

## License

Apache-2.0
