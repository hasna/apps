# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-xai is a TypeScript CLI and library for xAI's Grok API. It provides chat completions with multi-profile support.

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

## Models (2026)

| Model | Description |
|-------|-------------|
| `grok-4-0709` | Current flagship, 131K context — **recommended default** |
| `grok-4` / `grok-4-fast` | Grok 4 variants |
| `grok-4-1-fast-reasoning` | Grok 4.1 with reasoning |
| `grok-4-1-fast-non-reasoning` | Grok 4.1 fast, no reasoning |
| `grok-3` / `grok-3-mini` | Grok 3 series |
| `grok-2-vision` | Vision tasks |
| `grok-2-image` | Image generation |

Base URL: `https://api.x.ai/v1` (OpenAI-compatible)
Default: `grok-4-0709`

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-xai config set-key <key>`


## CLI Commands

```bash
# Quick commands
connect-xai ask <question>
connect-xai models

# Chat commands
connect-xai chat ask <question> [-m model] [-t temp]
connect-xai chat code <prompt>
connect-xai chat json <prompt>

# Config
connect-xai config set-key <key>
connect-xai config set-model <model>
connect-xai config show

# Profiles
connect-xai profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XAI_API_KEY` | API key |

## Data Storage

```
~/.connectors/connect-xai/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
