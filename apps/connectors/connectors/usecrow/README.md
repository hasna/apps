# @hasna/connect-usecrow

TypeScript connector for the [Crow Platform API](https://docs.usecrow.ai) — embedded agent chat, conversations, workflows, and remote browser-use sessions.

## Installation

```bash
bun add @hasna/connect-usecrow
```

## Configuration

Profiles are stored at `~/.hasna/connectors/connect-usecrow/`.

```bash
connect-usecrow config set-product-id <your-product-id>
connect-usecrow config set-identity-token <your-jwt>
```

Or use environment variables:

```bash
export USECROW_PRODUCT_ID=your-product-id
export USECROW_IDENTITY_TOKEN=your-jwt
```

## Usage

### CLI

```bash
connect-usecrow chat send --message "Hello"
connect-usecrow chat conversations
connect-usecrow workflow list
connect-usecrow browser-use start --body '{"url":"https://example.com"}'
```

### Library

```typescript
import { Connector } from '@hasna/connect-usecrow';

const client = new Connector({
  productId: 'your-product-id',
  identityToken: 'your-jwt',
});

const response = await client.chat.sendMessage({ message: 'Hello' });
const conversations = await client.chat.listConversations();
```

## API Surface

| Operation | Method | Path |
|-----------|--------|------|
| sendMessage | POST | `/api/chat/message` |
| listConversations | GET | `/api/chat/conversations` |
| getConversationHistory | GET | `/api/chat/conversations/:id/history` |
| getAnonymousConversationHistory | GET | `/api/chat/conversations/:id/history/anonymous` |
| listRecordedWorkflows | GET | `/api/products/:productId/recorded-workflows` |
| startBrowserUse | POST | `/api/browser-use/start` |
| browserUseStep | POST | `/api/browser-use/step` |
| endBrowserUse | POST | `/api/browser-use/end` |

Browser-use endpoints call Crow's remote HTTP API — there is no local browser automation dependency.

## License

Apache-2.0
