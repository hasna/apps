# connect-googlecalendar

Google Calendar API connector - TypeScript CLI and library for Google Calendar with OAuth2 authentication and multi-profile support

## Installation

```bash
bun install -g @hasna/connect-googlecalendar
```

## Quick Start

```bash
# Set your API key
connect-googlecalendar config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_CALENDAR_ACCESS_TOKEN=YOUR_API_KEY
```

## CLI Commands

```bash
connect-googlecalendar config set-key <key>     # Set API key
connect-googlecalendar config show              # Show config
connect-googlecalendar profile list             # List profiles
connect-googlecalendar profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googlecalendar profile create work --api-key xxx --use
connect-googlecalendar profile create personal --api-key yyy

# Switch profiles
connect-googlecalendar profile use work

# Use profile for single command
connect-googlecalendar -p personal <command>

# List profiles
connect-googlecalendar profile list
```

## Library Usage

```typescript
import { Googlecalendar } from '@hasna/connect-googlecalendar';

const client = new Googlecalendar({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CALENDAR_ACCESS_TOKEN` | Access token (overrides profile) |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Refresh token |
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth2 Client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth2 Client Secret |

## Data Storage

Configuration stored in `~/.connect/connect-googlecalendar/`:

```
~/.connect/connect-googlecalendar/
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
