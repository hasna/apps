# @hasna/connect-zoho-cliq

Zoho Cliq team chat and messaging API connector with CLI and library support.

## Installation

```bash
bun install -g @hasna/connect-zoho-cliq
```

## Quick Start

```bash
# Set OAuth access token and data center
connect-zoho-cliq config set-token your-oauth-token
connect-zoho-cliq config set-data-center com

# Verify authentication
connect-zoho-cliq test

# Send a channel message
connect-zoho-cliq messages send-channel general "Hello from CLI!"

# List channels
connect-zoho-cliq channels list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_CLIQ_TOKEN` | OAuth access token |
| `ZOHO_CLIQ_DATA_CENTER` | Data center: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` |
| `ZOHO_CLIQ_BASE_URL` | Optional API base URL override |

## Library Usage

```typescript
import { ZohoCliq } from '@hasna/connect-zoho-cliq';

const cliq = ZohoCliq.fromEnv();

const me = await cliq.users.me();
await cliq.messages.sendToChannelByName('general', { text: 'Hello!' });
const channels = await cliq.channels.list({ type: 'team' });
```

## API Coverage

- Users (`/users`, `/users/me`, status)
- Buddies
- Channels (CRUD, members, join/leave)
- Messages (channel, chat, edit, delete, pin)
- Chats (list, group create)
- Organization departments
- Bots

See [Zoho Cliq REST API v2](https://www.zoho.com/cliq/help/restapi/v2/) for full API documentation.

## License

Apache-2.0
