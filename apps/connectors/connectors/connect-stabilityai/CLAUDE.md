# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Stability AI API connector CLI - Image generation, editing, upscaling, and 3D model generation

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

## Models (2025-2026)

| Model | Endpoint | Description |
|-------|----------|-------------|
| `sd3.5-large` | `/v2beta/stable-image/generate/sd3` | Highest quality |
| `sd3.5-large-turbo` | `/v2beta/stable-image/generate/sd3` | Fast SD 3.5 |
| `sd3.5-medium` | `/v2beta/stable-image/generate/sd3` | Balanced, MMDiT-X arch |
| `stable-image-ultra` | `/v2beta/stable-image/generate/ultra` | Ultra quality |
| `stable-image-core` | `/v2beta/stable-image/generate/core` | Fast and affordable |

SD 3.5 Medium: Keep prompts under 256 T5 tokens. Use Skip Layer Guidance for better anatomy.
License: Community License free for <$1M annual revenue; Enterprise required above.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-stabilityai config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `STABILITYAI_API_KEY` | API key |

## Data Storage

```
~/.connectors/connect-stabilityai/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
