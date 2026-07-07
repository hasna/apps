# connect-timelinesai

TypeScript connector for the [TimelinesAI Public REST API](https://timelines.ai/docs/public-api-reference/overview). Manage WhatsApp team inbox chats, send messages, and list connected WhatsApp accounts.

## Install

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set your API token from [TimelinesAI Public API settings](https://app.timelines.ai/integrations/api/):

```bash
TIMELINESAI_API_KEY=your-api-key-here
```

Or use the CLI profile system:

```bash
bun run dev config set-key <your-api-key>
```

Profiles are stored in `~/.hasna/connectors/connect-timelinesai/profiles/`.

## CLI Usage

```bash
# List chats
bun run dev chats list

# Get chat details
bun run dev chats get 1000001

# Send message to phone
bun run dev messages send +14840000000 "Hello from API"

# Send message to existing chat
bun run dev messages send-chat 1000001 "Follow-up message"

# List chat messages
bun run dev messages list 1000001

# List WhatsApp accounts
bun run dev whatsapp-accounts
```

## Library Usage

```typescript
import { TimelinesAI } from '@hasna/connect-timelinesai';

const timelines = new TimelinesAI({ apiKey: process.env.TIMELINESAI_API_KEY! });

const chats = await timelines.chats.list({ page: 1 });
const sent = await timelines.messages.sendToPhone({
  phone: '+14840000000',
  text: 'Hello!',
});
const accounts = await timelines.whatsappAccounts.list();
```

## Development

```bash
bun run dev --help
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
