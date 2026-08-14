# connect-userpilot

TypeScript connector for the [Userpilot](https://userpilot.com) Analytics API. Provides CLI and programmatic access to user identification, event tracking, experiences, flows, checklists, surveys, segments, goals, and webhooks.

## Installation

```bash
bun install
bun run build
```

## Authentication

Userpilot uses a single API key (Bearer token). Get your key from **Settings → API** in the Userpilot dashboard.

```bash
connect-userpilot auth set-key <your-api-key>
connect-userpilot auth status
```

Or set `USERPILOT_API_KEY` in your environment.

## CLI Examples

```bash
# Identify a user
connect-userpilot users identify -u user123 -m '{"plan":"pro"}'

# Track an event
connect-userpilot users track -u user123 -e "feature_used" -m '{"feature":"export"}'

# List experiences
connect-userpilot experiences list --status published

# List segments
connect-userpilot segments list --type user

# Create a webhook
connect-userpilot webhooks create -u https://example.com/hook -e "user.created,survey.completed"
```

## Library Usage

```typescript
import { Userpilot } from '@hasna/connect-userpilot';

const client = Userpilot.fromEnv();

await client.users.identify({ user_id: 'user123', metadata: { plan: 'pro' } });
await client.users.track({ user_id: 'user123', event_name: 'signup' });
const experiences = await client.experiences.list();
```

## API

- Base URL: `https://analytex.userpilot.io/v1`
- Auth: `Authorization: Bearer {api_key}`
- Header: `X-API-Version: 2020-09-22`

## License

Apache-2.0
