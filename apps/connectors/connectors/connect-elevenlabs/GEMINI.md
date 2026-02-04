# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-elevenlabs is a TypeScript connector for the ElevenLabs API. It provides both a CLI and library interface for:

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

API Key (Header) authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-elevenlabs config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | API key (primary) |
| `XI_API_KEY` | API key (alternative) |
| `ELEVENLABS_VOICE_ID` | Default voice ID |
| `ELEVENLABS_MODEL_ID` | Default TTS model |
| `ELEVENLABS_OUTPUT_DIR` | Output directory for audio files |

## Data Storage

```
~/.connect/connect-elevenlabs/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
