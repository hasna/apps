# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-anthropic is a TypeScript CLI and library for Anthropic's Claude API. It provides the Messages API for chat and code generation with multi-profile support.

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
- Profile configuration: `connect-anthropic config set-key <key>`


## CLI Commands

```bash
# Quick commands
connect-anthropic ask <question>
connect-anthropic models

# Messages commands
connect-anthropic messages ask <question> [-m model] [-t temp] [-s system]
connect-anthropic messages code <prompt> [-m model]
connect-anthropic messages json <prompt> [-m model]

# Config
connect-anthropic config set-key <key>
connect-anthropic config set-model <model>
connect-anthropic config show

# Profiles
connect-anthropic profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key |

## Data Storage

```
~/.connect/connect-anthropic/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
