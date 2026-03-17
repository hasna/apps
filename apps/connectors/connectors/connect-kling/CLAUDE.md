# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

scaffold-connector is a TypeScript template for building API connector CLIs. It provides multi-profile configuration, Bearer token authentication (customizable), and a clean CLI structure using Commander.js.

**This is a SCAFFOLD** - meant to be cloned and customized for specific APIs.

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
bun run dev profile list
bun run dev config show
bun run dev example list
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
│   ├── client.ts     # HTTP client with authentication
│   ├── example.ts    # Example API module (template)
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

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/{connector-name}/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Default is Bearer token in `src/api/client.ts`:
```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

Customize for different auth methods:
- API Key header: `'X-API-Key': this.apiKey`
- Basic auth: `'Authorization': 'Basic ' + base64(key:secret)`
- OAuth: Add token refresh logic

### Adding New API Modules

1. Create file in `src/api/` following `example.ts` pattern
2. Add to exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## TODO Markers

When customizing this scaffold, search for `TODO` comments:

- `src/cli/index.ts:22-24` - CONNECTOR_NAME, VERSION, description
- `src/utils/config.ts:5-6` - CONNECTOR_NAME, env var prefix
- `src/api/client.ts:5` - DEFAULT_BASE_URL
- `src/api/client.ts:45-48` - Authentication method
- `src/api/index.ts:7` - Rename Connector class
- `src/types/index.ts` - Replace example types

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONNECTOR_API_KEY` | API key (overrides profile) |
| `CONNECTOR_API_SECRET` | API secret (optional) |
| `CONNECTOR_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/{connector-name}/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "sk-xxx",
  "apiSecret": "optional"
}
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
