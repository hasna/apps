# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-huggingface is a TypeScript connector for the HuggingFace API. It provides multi-profile configuration, Bearer token authentication, and a clean CLI structure using Commander.js.

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
- Profile configuration: `connect-huggingface config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/huggingface/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Bearer token in `src/api/client.ts`:
```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HUGGINGFACE_API_KEY` | API key (overrides profile) |
| `HF_TOKEN` | Alternative API key (HuggingFace convention) |
| `HUGGINGFACE_API_SECRET` | API secret (optional) |
| `HUGGINGFACE_BASE_URL` | Override base URL |

### Base URL

Default: `https://huggingface.co/api`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HUGGINGFACE_API_KEY` | API key (overrides profile) |
| `HF_TOKEN` | Alternative API key (HuggingFace convention) |
| `HUGGINGFACE_API_SECRET` | API secret (optional) |
| `HUGGINGFACE_BASE_URL` | Override base URL |

### Base URL

Default: `https://huggingface.co/api`

## Data Storage

```
~/.connect/connect-huggingface/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
