# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-googlecontacts is a TypeScript connector for the Google People API (Contacts). It provides both a programmatic library and CLI for managing Google Contacts with OAuth2 authentication and multi-profile support.

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
- Profile configuration: `connect-googlecontacts config set-key <key>`
- OAuth flow: `connect-googlecontacts oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-googlecontacts/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### OAuth2 Authentication

This connector uses OAuth2 with Google:

1. Set credentials: `connect-googlecontacts config set-credentials --client-id X --client-secret Y`
2. Get auth URL: `connect-googlecontacts oauth url`
3. Exchange code: `connect-googlecontacts oauth exchange --code Z`
4. Tokens auto-refresh when expired

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CONTACTS_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CONTACTS_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_CONTACTS_ACCESS_TOKEN` | Access token (overrides profile) |
| `GOOGLE_CONTACTS_REFRESH_TOKEN` | Refresh token (overrides profile) |
| `GOOGLE_CONTACTS_REDIRECT_URI` | OAuth redirect URI |

### Data Storage

```
~/.connect/connect-googlecontacts/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "xxx",
  "accessToken": "<ACCESS_TOKEN>",
  "refreshToken": "1//xxx",
  "tokenExpiresAt": 1234567890000,
  "redirectUri": "urn:ietf:wg:oauth:2.0:oob"
}
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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CONTACTS_CLIENT_ID` | OAuth Client ID |
| `GOOGLE_CONTACTS_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_CONTACTS_ACCESS_TOKEN` | Access token (overrides profile) |
| `GOOGLE_CONTACTS_REFRESH_TOKEN` | Refresh token (overrides profile) |
| `GOOGLE_CONTACTS_REDIRECT_URI` | OAuth redirect URI |

### Data Storage

```
~/.connect/connect-googlecontacts/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "xxx",
  "accessToken": "<ACCESS_TOKEN>",
  "refreshToken": "1//xxx",
  "tokenExpiresAt": 1234567890000,
  "redirectUri": "urn:ietf:wg:oauth:2.0:oob"
}
```

## Data Storage

```
~/.connect/connect-googlecontacts/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
