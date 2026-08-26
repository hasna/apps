# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-openai is a TypeScript CLI and library for OpenAI's API. It provides chat completions, embeddings, and image generation with multi-profile support.

## Models (2026)

| Model | Description |
|-------|-------------|
| `gpt-4.1-mini` | Fast, cheap — **use as default** |
| `gpt-4.1` | High capability |
| `o3` | Advanced reasoning |
| `o4-mini` | Fast reasoning |
| `gpt-image-1` | Image generation (preferred over DALL-E 3) |

Default: `gpt-4.1-mini`

Note: GPT-4o, GPT-4.1, o4-mini retired from **ChatGPT** Feb 2026 — still available in API.

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
- Profile configuration: `connect-openai config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key |
| `OPENAI_ORGANIZATION` | Organization ID |

## Data Storage

```
~/.hasna/connectors/connect-openai/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
