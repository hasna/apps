# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-supabase is a TypeScript connector for the Supabase API. It provides a CLI and library for managing auth, database, storage, and edge functions.

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

# Run specific commands
bun run dev auth status
bun run dev storage buckets
bun run dev users list
bun run dev db select <table>
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with dual key auth
│   └── index.ts      # Supabase API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   └── config.ts     # Multi-profile configuration
└── index.ts          # Library exports
```

## API Authentication

Supabase uses two types of API keys:
- **Service Role Key**: Full access, bypasses RLS (for admin operations)
- **Anon Key**: Public key, respects RLS (for client operations)

Both keys are passed via:
- `apikey` header
- `Authorization: Bearer <key>` header

## API Endpoints

Each Supabase project has multiple APIs:
- `/rest/v1` - Database (PostgREST)
- `/auth/v1` - Authentication
- `/storage/v1` - Storage
- `/functions/v1` - Edge Functions

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-supabase/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Database Operations (PostgREST)

Use PostgREST syntax for filters:
- `eq.value` - Equals
- `neq.value` - Not equals
- `gt.value`, `gte.value` - Greater than
- `lt.value`, `lte.value` - Less than
- `like.*pattern*` - Pattern match

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin) |
| `SUPABASE_ANON_KEY` | Anon/public key |

## CLI Commands

- `auth set-url/set-key/set-anon-key/status/clear` - Configuration
- `profile list/use/create/delete/show` - Profile management
- `users list/get/create/delete/invite` - User management (admin)
- `storage buckets/create-bucket/delete-bucket/list/upload/download/url` - Storage
- `db select/insert/update/delete/rpc` - Database operations
- `functions invoke` - Edge Functions

## Data Storage

```
~/.hasna/connectors/connect-supabase/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "projectUrl": "https://xxx.supabase.co",
  "serviceRoleKey": "eyJ...",
  "anonKey": "eyJ..."
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
