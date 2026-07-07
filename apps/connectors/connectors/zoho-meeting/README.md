# Zoho Meeting Connector

TypeScript connector for the [Zoho Meeting REST API v2](https://www.zoho.com/meeting/api/). Provides sessions, webinars, recordings, and reports with OAuth token authentication and multi-profile CLI configuration.

## Install

```bash
bun install
```

## Configuration

```bash
export ZOHO_MEETING_TOKEN=your_oauth_access_token
export ZOHO_MEETING_DATA_CENTER=com

connect-zoho-meeting config set --token <token> --data-center com
```

Profiles are stored under `~/.hasna/connectors/zoho-meeting/`.

## CLI

```bash
connect-zoho-meeting sessions list
connect-zoho-meeting sessions create "Weekly sync" --start 2026-07-04T10:00:00Z --duration 60
connect-zoho-meeting webinars list
connect-zoho-meeting recordings list
connect-zoho-meeting reports session <sessionKey>
```

## Library

```typescript
import { ZohoMeeting } from '@hasna/connect-zoho-meeting';

const client = ZohoMeeting.fromEnv();
const sessions = await client.sessions.list({ type: 'upcoming' });
```

## License

Apache-2.0
