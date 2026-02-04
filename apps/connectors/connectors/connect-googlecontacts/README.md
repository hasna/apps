# connect-googlecontacts

Google Contacts (People API) connector - A TypeScript library and CLI for interacting with Google Contacts

## Installation

```bash
bun install -g @hasna/connect-googlecontacts
```

## Quick Start

```bash
# Set your API key
connect-googlecontacts config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_CONTACTS_CLIENT_ID=YOUR_API_KEY
```

## CLI Commands

### Profile Management
- `connect-googlecontacts profile list` - List profiles
- `connect-googlecontacts profile create <name>` - Create profile
- `connect-googlecontacts profile use <name>` - Switch profile
- `connect-googlecontacts profile delete <name>` - Delete profile

### Configuration
- `connect-googlecontacts config set-credentials` - Set OAuth credentials
- `connect-googlecontacts config show` - Show current config
- `connect-googlecontacts config clear` - Clear config

### OAuth
- `connect-googlecontacts oauth url` - Get authorization URL
- `connect-googlecontacts oauth exchange --code X` - Exchange code for tokens
- `connect-googlecontacts oauth refresh` - Refresh access token

### Contacts
- `connect-googlecontacts contacts list` - List contacts
- `connect-googlecontacts contacts get <resourceName>` - Get contact
- `connect-googlecontacts contacts create` - Create contact
- `connect-googlecontacts contacts update <resourceName>` - Update contact
- `connect-googlecontacts contacts delete <resourceName>` - Delete contact
- `connect-googlecontacts contacts search <query>` - Search contacts
- `connect-googlecontacts contacts export` - Export to JSONL
- `connect-googlecontacts contacts groups` - List contact groups

## Profile Management

```bash
# Create profiles for different accounts
connect-googlecontacts profile create work --api-key xxx --use
connect-googlecontacts profile create personal --api-key yyy

# Switch profiles
connect-googlecontacts profile use work

# Use profile for single command
connect-googlecontacts -p personal <command>

# List profiles
connect-googlecontacts profile list
```

## Library Usage

```typescript
import { Googlecontacts } from '@hasna/connect-googlecontacts';

const client = new Googlecontacts({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CONTACTS_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CONTACTS_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_CONTACTS_ACCESS_TOKEN` | Access token (overrides profile) |
| `GOOGLE_CONTACTS_REFRESH_TOKEN` | Refresh token (overrides profile) |
| `GOOGLE_CONTACTS_REDIRECT_URI` | OAuth redirect URI |

## Data Storage

Configuration stored in `~/.connect/connect-googlecontacts/`:

```
~/.connect/connect-googlecontacts/
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
