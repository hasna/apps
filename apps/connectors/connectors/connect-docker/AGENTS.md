# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-docker is a TypeScript connector for the Docker Hub API. It provides multi-profile configuration, access token or username/password authentication, and a clean CLI structure using Commander.js.

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

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-docker config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/docker/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Docker Hub supports two authentication methods:

1. **Access Token (recommended)**:
```typescript
const docker = new Docker({ accessToken: 'dckr_pat_xxx' });
```

2. **Username/Password**:
```typescript
const docker = new Docker({ username: 'user', password: 'pass' });
```

The client handles JWT token acquisition and renewal automatically.

### Adding New API Modules

1. Create file in `src/api/` following `example.ts` pattern
2. Add to exports in `src/api/index.ts`
3. Add types in `src/types/index.ts`
4. Add CLI commands in `src/cli/index.ts`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DOCKER_ACCESS_TOKEN` | Access token (recommended) |
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password |
| `DOCKER_BASE_URL` | Override base URL |

## Data Storage

```
~/.connect/connect-docker/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
