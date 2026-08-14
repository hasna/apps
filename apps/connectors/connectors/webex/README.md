# @hasna/connect-webex

Cisco Webex API connector with CLI and TypeScript library support.

## Installation

```bash
bun install @hasna/connect-webex
```

## Authentication

Set a Webex personal access token or bot token:

```bash
export WEBEX_ACCESS_TOKEN=your-token
# or
connect-webex config set-token your-token
```

Get a token from [Webex for Developers](https://developer.webex.com/docs/getting-started).

## CLI Usage

```bash
connect-webex test
connect-webex rooms list
connect-webex messages send --room-id Y2lz... --text "Hello"
connect-webex meetings list --from 2026-01-01T00:00:00Z --to 2026-12-31T23:59:59Z
connect-webex people me
connect-webex webhooks list
```

## Library Usage

```typescript
import { Webex } from '@hasna/connect-webex';

const webex = Webex.fromEnv();
const me = await webex.people.me();
const rooms = await webex.rooms.list();
```

## API Coverage

- Rooms
- Memberships
- Messages
- People
- Teams
- Meetings
- Recordings
- Webhooks

## License

Apache-2.0
