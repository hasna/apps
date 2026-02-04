# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-midjourney is a TypeScript connector for Midjourney image generation. Since Midjourney doesn't have an official API, this connector is designed to work with third-party API services or Discord bot automation.

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

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-midjourney config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/midjourney/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Default is Bearer token in `src/api/client.ts`:
```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

May need adjustment based on third-party API provider.

### Adding New API Modules

1. Create file in `src/api/` following `imagine.ts` pattern
2. Add to exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIDJOURNEY_API_KEY` | API key for third-party service |
| `DISCORD_TOKEN` | Discord bot token (optional) |
| `MIDJOURNEY_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/connect-midjourney/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
