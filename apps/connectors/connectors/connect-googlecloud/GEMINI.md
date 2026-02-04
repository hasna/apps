# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-googlecloud is a TypeScript connector for the Google Cloud Resource Manager API. It provides multi-profile configuration, support for both API key and service account authentication, and a clean CLI structure using Commander.js.

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
- Profile configuration: `connect-googlecloud config set-key <key>`
- OAuth flow: `connect-googlecloud oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/googlecloud/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Two authentication methods supported in `src/api/client.ts`:

1. **API Key**: Appended to URL as `?key=...`
2. **Service Account**: OAuth2 JWT token exchange

```typescript
// API Key (simple, for public APIs)
const client = new GoogleCloud({ apiKey: 'YOUR_KEY' });

// Service Account (full access, for production)
const client = new GoogleCloud({ credentialsPath: '/path/to/creds.json' });
```

### Adding New API Modules

1. Create file in `src/api/` following `projects.ts` pattern
2. Add to exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLOUD_API_KEY` | API key (overrides profile) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `GOOGLE_CLOUD_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/connect-googlecloud/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
