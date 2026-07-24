# WATI WhatsApp Business Connector

TypeScript connector for the [WATI WhatsApp Business API](https://docs.wati.io). Provides CLI and library access to contacts, messages, templates, operators, labels, attributes, and broadcasts.

## Installation

```bash
bun install
```

## Configuration

WATI requires a per-tenant base URL and Bearer API key:

```bash
connect-wati config set-key YOUR_API_KEY
connect-wati config set-base-url https://live-server.wati.io/123456
```

Or via environment variables:

```bash
export WATI_API_KEY=your_api_key
export WATI_BASE_URL=https://live-server.wati.io/123456
```

## CLI Examples

```bash
# Contacts
connect-wati contacts list
connect-wati contacts add +15551234 --name "Ada Lovelace"

# Messages
connect-wati messages send-session +15551234 "Hello!"
connect-wati messages send-template +15551234 welcome

# Templates & operators
connect-wati templates list
connect-wati operators list
connect-wati operators update-chat-status +15551234 RESOLVED

# Broadcasts
connect-wati broadcasts list
connect-wati broadcasts details Launch
```

## Programmatic Usage

```typescript
import { Wati } from '@hasna/connect-wati';

const wati = new Wati({
  apiKey: process.env.WATI_API_KEY!,
  baseUrl: process.env.WATI_BASE_URL!,
});

const contacts = await wati.contacts.getContacts({ pageSize: 10 });
await wati.messages.sendSessionMessage({
  whatsappNumber: '+15551234',
  messageText: 'Hello from WATI!',
});
```

## License

Apache-2.0
