# scaffold-connector

A TypeScript scaffold for building API connector CLIs with multi-profile support.

## Features

- Multi-profile configuration (switch between different API keys/accounts)
- Bearer token authentication (easily customizable)
- Clean CLI structure with Commander.js
- Pretty and JSON output formats
- TypeScript with strict mode

## Quick Start

### 1. Clone and Rename

```bash
# Clone for your connector
git clone https://github.com/hasna/apps.git
cd apps/connectors/connectors/connect-yourapi

# Update package.json name
# Change "@hasna/scaffold-connector" to "@hasna/connect-yourapi"
```

### 2. Update Configuration

Search for `TODO` comments throughout the codebase and update:

- `src/cli/index.ts` - Update `CONNECTOR_NAME` and description
- `src/utils/config.ts` - Update `CONNECTOR_NAME` and env var names
- `src/api/client.ts` - Update `DEFAULT_BASE_URL` and authentication method
- `src/api/index.ts` - Rename `Connector` class to your API name
- `src/types/index.ts` - Add your API's type definitions
- `package.json` - Update name, description, bin command
- `.env.example` - Update environment variable names

### 3. Install and Test

```bash
# Install dependencies
bun install

# Run CLI
bun run dev

# Or run specific commands
bun run dev profile list
bun run dev config show
```

## CLI Structure

```bash
connector [options] [command]

Options:
  -k, --api-key <key>      API key (overrides config)
  -f, --format <format>    Output format (json, pretty)
  -p, --profile <profile>  Use a specific profile

Commands:
  profile list             List all profiles
  profile use <name>       Switch to a profile
  profile create <name>    Create a new profile
  profile delete <name>    Delete a profile
  profile show [name]      Show profile configuration

  config set-key <key>     Set API key for active profile
  config show              Show current configuration
  config clear             Clear configuration

  example list             Example API command (replace)
  example get <id>         Example API command (replace)
  example create           Example API command (replace)
```

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with authentication
│   ├── example.ts    # Example API module (replace with your API)
│   └── index.ts      # Main connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Multi-Profile Configuration

Profiles are stored in `~/.hasna/connectors/{connector-name}/profiles/`:

```
~/.hasna/connectors/connector/
├── current_profile   # Name of active profile
└── profiles/
    ├── default.json  # Default profile
    ├── work.json     # Named profile
    └── personal.json # Named profile
```

### Profile Commands

```bash
# Create profiles
connector profile create work --api-key sk-xxx --use
connector profile create personal --api-key sk-yyy

# Switch profiles
connector profile use work

# Use profile for single command
connector -p personal example list

# List profiles
connector profile list
```

## Customizing Authentication

Edit `src/api/client.ts` to change authentication:

```typescript
// Bearer token (default)
'Authorization': `Bearer ${this.apiKey}`,

// API Key header
'X-API-Key': this.apiKey,

// Basic auth
'Authorization': `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`,
```

## Adding API Endpoints

1. Create a new file in `src/api/` (e.g., `users.ts`)
2. Export it from `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

Example API module:

```typescript
// src/api/users.ts
import type { ConnectorClient } from './client';

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(options?: { limit?: number }) {
    return this.client.get('/users', { limit: options?.limit });
  }

  async get(id: string) {
    return this.client.get(`/users/${id}`);
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile config) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL (optional) |

## Development

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

## License

Apache-2.0
