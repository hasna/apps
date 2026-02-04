# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-e2b is a TypeScript connector for the E2B Code Interpreter API. E2B provides secure cloud sandboxes for running AI-generated code in isolated environments. This connector provides both a programmatic API and a CLI for interacting with E2B sandboxes.

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
- Profile configuration: `connect-e2b config set-key <key>`


## CLI Commands

### Sandbox Management

```bash
connect-e2b sandbox create [--template <template>] [--timeout <ms>]
connect-e2b sandbox list
connect-e2b sandbox get <sandboxId>
connect-e2b sandbox kill <sandboxId>
connect-e2b sandbox keep-alive <sandboxId> [--timeout <ms>]
```

### Code Execution

```bash
connect-e2b run "<code>" [--language <lang>] [--sandbox <id>] [--no-cleanup]
connect-e2b exec "<command>" [--sandbox <id>] [--workdir <path>]
```

### File Operations

```bash
connect-e2b file read <sandboxId> <path>
connect-e2b file write <sandboxId> <path> <content>
connect-e2b file list <sandboxId> [path]
connect-e2b file mkdir <sandboxId> <path>
connect-e2b file rm <sandboxId> <path>
```

### Configuration

```bash
connect-e2b config set-key <apiKey>
connect-e2b config set-template <template>
connect-e2b config set-timeout <ms>
connect-e2b config show
connect-e2b config clear
```

### Profile Management

```bash
connect-e2b profile list
connect-e2b profile create <name> [--api-key <key>] [--use]
connect-e2b profile use <name>
connect-e2b profile delete <name>
connect-e2b profile show [name]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `E2B_API_KEY` | E2B API key (required) |
| `E2B_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.connect/connect-e2b/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
