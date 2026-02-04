# connect-zoom

Zoom connector CLI - Meetings, Webinars, Recordings, Users with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-zoom
```

## Quick Start

```bash
# Set your API key
connect-zoom config set-key YOUR_API_KEY

# Or use environment variable
export ZOOM_ACCOUNT_ID=YOUR_API_KEY
```

## CLI Commands

### Configuration
```bash
connect-zoom config set --account-id <id> --client-id <id> --client-secret <secret>
connect-zoom config show
connect-zoom config clear
```

### Profile Management
```bash
connect-zoom profile list
connect-zoom profile use <name>
connect-zoom profile create <name> --account-id <id> --client-id <id> --client-secret <secret>
connect-zoom profile delete <name>
connect-zoom profile show [name]
```

### Users
```bash
connect-zoom me                        # Get current user
connect-zoom users list                # List all users
connect-zoom users get <userId>        # Get user details
```

### Meetings
```bash
connect-zoom meetings list [userId]    # List meetings
connect-zoom meetings get <meetingId>  # Get meeting details
connect-zoom meetings create <topic> --start <datetime> --duration <minutes>
connect-zoom meetings update <meetingId> --topic <topic>
connect-zoom meetings delete <meetingId>
connect-zoom meetings end <meetingId>  # End live meeting
```

### Webinars
```bash
connect-zoom webinars list [userId]    # List webinars
connect-zoom webinars get <webinarId>  # Get webinar details
connect-zoom webinars create <topic>   # Create webinar
connect-zoom webinars delete <webinarId>
```

### Recordings
```bash
connect-zoom recordings list [userId] --from <date> --to <date>
connect-zoom recordings get <meetingId>
connect-zoom recordings delete <meetingId> [--permanent]
```

### Reports
```bash
connect-zoom reports meetings [userId] --from <date> --to <date>
connect-zoom reports meeting <meetingId>
connect-zoom reports participants <meetingId>
connect-zoom reports daily --year <year> --month <month>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-zoom profile create work --api-key xxx --use
connect-zoom profile create personal --api-key yyy

# Switch profiles
connect-zoom profile use work

# Use profile for single command
connect-zoom -p personal <command>

# List profiles
connect-zoom profile list
```

## Library Usage

```typescript
import { Zoom } from '@hasna/connect-zoom';

const client = new Zoom({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOOM_ACCOUNT_ID` | Zoom Account ID (overrides profile) |
| `ZOOM_CLIENT_ID` | Zoom Client ID (overrides profile) |
| `ZOOM_CLIENT_SECRET` | Zoom Client Secret (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-zoom/`:

```
~/.connect/connect-zoom/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
