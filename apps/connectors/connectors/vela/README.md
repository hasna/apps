# connect-vela

TypeScript connector for the [Vela](https://tryvela.ai/) AI scheduling API.

## Features

- Scheduling requests: list, get, create
- Meetings: list, get, cancel, reschedule
- Contacts: list
- Calendar sync
- Raw request escape hatch
- Multi-profile configuration
- Bearer token authentication

## Installation

```bash
bun install
```

## Configuration

```bash
# Set API key
connect-vela config set-key <your-api-key>

# Or use environment variable
export VELA_API_KEY=your-api-key-here
```

## CLI Commands

```bash
connect-vela list-scheduling-requests
connect-vela get-scheduling-request <requestId>
connect-vela create-scheduling-request --subject "Interview" --json '{"participants":["a@x.com"]}'

connect-vela list-meetings
connect-vela get-meeting <meetingId>
connect-vela cancel-meeting <meetingId> --reason "conflict"
connect-vela reschedule-meeting <meetingId> --start-at "2026-05-23T15:00:00Z"

connect-vela list-contacts
connect-vela sync-calendar --provider google

connect-vela raw-request --path /custom/agents --method POST --json '{"enabled":true}'
```

## Programmatic Usage

```typescript
import { Vela } from '@hasna/connect-vela';

const vela = new Vela({ apiKey: process.env.VELA_API_KEY! });

const requests = await vela.schedulingRequests.list({ status: 'pending' });
const meeting = await vela.meetings.get('meet-123');
await vela.calendar.sync({ provider: 'google' });
```

## Development

```bash
bun run dev --help
bun run typecheck
bun run build
bun test src/api/vela.test.ts
```

## License

Apache-2.0
