# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-zoom is a TypeScript connector for the Zoom API with Server-to-Server OAuth and multi-profile configuration support. It provides access to Users, Meetings, Webinars, Recordings, and Reports APIs.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-zoom config set-key <key>`
- OAuth flow: `connect-zoom oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-zoom/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config
- Access tokens are cached in profiles with expiry

### Authentication

Uses Server-to-Server OAuth (account credentials grant). Credentials can be set via:
- Environment variables: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
- Profile configuration: `connect-zoom config set`

Tokens are automatically cached and refreshed when expired.

### Service APIs

Each Zoom service has its own API module:
- **UsersApi**: Get current user, list users, get user details
- **MeetingsApi**: List, create, get, update, delete, end meetings
- **WebinarsApi**: List, create, get, update, delete webinars
- **RecordingsApi**: List, get, delete cloud recordings
- **ReportsApi**: Meeting/webinar reports, participants, daily usage

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOOM_ACCOUNT_ID` | Zoom Account ID (overrides profile) |
| `ZOOM_CLIENT_ID` | Zoom Client ID (overrides profile) |
| `ZOOM_CLIENT_SECRET` | Zoom Client Secret (overrides profile) |

## Data Storage

```
~/.connect/connect-zoom/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
