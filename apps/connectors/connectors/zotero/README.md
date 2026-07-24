# @hasna/connect-zotero

Zotero Web API v3 connector with CLI and library support. Manage bibliography items, collections, and file attachments via the official Zotero REST API.

## Installation

```bash
bun add @hasna/connect-zotero
```

For CLI usage:

```bash
bun install -g @hasna/connect-zotero
```

## Configuration

### Environment Variables

```bash
export ZOTERO_API_KEY="your-api-key"
export ZOTERO_LIBRARY_ID="your-library-id"
export ZOTERO_LIBRARY_TYPE="users"   # or groups
# export ZOTERO_BASE_URL="https://api.zotero.org"
```

### CLI Configuration

```bash
connect-zotero config set-api-key <key>
connect-zotero config set-library-id <id>
connect-zotero config set-library-type users
connect-zotero config show
```

Configuration is stored in `~/.hasna/connectors/connect-zotero/`.

## CLI Usage

```bash
# Test authentication
connect-zotero test

# List items
connect-zotero items list
connect-zotero items list --collection <key> --limit 25

# Search items
connect-zotero items search "machine learning"

# Get, create, update, delete items
connect-zotero items get <itemKey>
connect-zotero items create --json ./item.json
connect-zotero items update <itemKey> --json ./patch.json --version 12
connect-zotero items delete <itemKey> --version 12

# Collections
connect-zotero collections list
connect-zotero collections create --json ./collection.json

# Attachments
connect-zotero attachments create --json ./attachment.json
connect-zotero attachments upload --file ./paper.pdf --parent <itemKey>

# Raw API escape hatch
connect-zotero raw /users/1234567/items -X GET
```

## Library Usage

```typescript
import { Zotero } from '@hasna/connect-zotero';

const zotero = new Zotero({
  apiKey: process.env.ZOTERO_API_KEY!,
  libraryId: process.env.ZOTERO_LIBRARY_ID!,
  libraryType: 'users',
});

const items = await zotero.items.list({ limit: 10 });
const results = await zotero.items.search('neural networks');
```

## API Reference

- [Zotero Web API v3](https://www.zotero.org/support/dev/web_api/v3/start)

## License

Apache-2.0
