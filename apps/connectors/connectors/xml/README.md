# @hasna/connect-xml

TypeScript connector for the [XML.com](https://api.xml.com) REST API — documents, events, and search.

## Installation

```bash
bun install
```

## Configuration

Set credentials via environment variables or profile:

```bash
export XML_API_KEY=your_api_key_here
# Optional:
export XML_BASE_URL=https://api.xml.com/v1
```

Or use the CLI:

```bash
connect-xml config set-key <api-key>
connect-xml config set-base-url https://api.xml.com/v1
```

Profiles are stored in `~/.hasna/connectors/xml/profiles/`.

## CLI Usage

```bash
# Documents
connect-xml documents list
connect-xml documents get <documentId>
connect-xml documents create --body '{"name":"invoice.xml"}'

# Events
connect-xml events

# Search
connect-xml search --body '{"query":"invoice"}'

# Raw API escape hatch
connect-xml raw-request --path /documents --method GET
```

## Library Usage

```typescript
import { Xml } from '@hasna/connect-xml';

const xml = Xml.fromEnv();
const documents = await xml.listDocuments();
const doc = await xml.getDocument('item-1');
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
