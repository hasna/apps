# connect-twilio-api-platform

TypeScript CLI and SDK for the Twilio Api Platform REST API.

> **Note:** This connector targets `api.twilioapiplatform.com` and is separate from `@hasna/connect-twilio` (classic Twilio Programmable Messaging/Voice).

## Install

```bash
bun install -g @hasna/connect-twilio-api-platform
```

## Quick start

```bash
export TWILIO_API_PLATFORM_API_KEY=your-api-key
connect-twilio-api-platform items list
```

Or configure a profile:

```bash
connect-twilio-api-platform config set-key YOUR_API_KEY
connect-twilio-api-platform items list
```

## CLI commands

```bash
connect-twilio-api-platform items list [--query '{"limit":10}']
connect-twilio-api-platform items get <itemId>
connect-twilio-api-platform items create --body '{"name":"example"}'
connect-twilio-api-platform events list
connect-twilio-api-platform search --body '{"query":"term"}'
connect-twilio-api-platform raw --path /items [--method GET] [--query '{}'] [--body '{}']
connect-twilio-api-platform profile list
connect-twilio-api-platform config show
```

## Library usage

```typescript
import { TwilioApiPlatform } from '@hasna/connect-twilio-api-platform';

const api = TwilioApiPlatform.fromEnv();
const items = await api.listItems();
const item = await api.getItem('item-1');
```

## License

Apache-2.0
