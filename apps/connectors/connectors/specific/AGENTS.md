# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-specific is a TypeScript connector for the Specific public GraphQL API. Specific is an AI conversational-survey and user-research platform. The connector provides multi-profile configuration, raw API-key authentication, and a clean CLI structure using Commander.js.

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
├── api/              # API client modules
│   ├── client.ts     # GraphQL transport with authentication
│   ├── operations.ts # GraphQL query/mutation documents
│   └── index.ts      # Main connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # TypeScript types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API & Authentication

Specific exposes a single GraphQL endpoint: `https://public-api.specific.app/graphql`
(interactive docs at `https://public-api.specific.app/docs`).

Requests are `POST { query, variables }`. The personal API key is sent **raw** in
the `Authorization` header — there is **no** `Bearer ` prefix:

```typescript
'Authorization': this.apiKey,
```

Credentials can be set via:
- Environment variable `SPECIFIC_API_KEY`
- Profile configuration: `specific config set-key <key>`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/specific/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks the active profile
- `--profile` flag overrides for a single command
- Environment variables override profile config

### Adding New Operations

1. Add the GraphQL document to `src/api/operations.ts`
2. Add a typed method to the `Specific` class in `src/api/index.ts`
3. Add response types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPECIFIC_API_KEY` | Personal API key (overrides profile) |
| `SPECIFIC_BASE_URL` | Override the GraphQL endpoint |

## Data Storage

```
~/.hasna/connectors/specific/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
