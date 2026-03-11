# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

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

## Models (2026)

| Model | Description |
|-------|-------------|
| `eleven_v3` | **Eleven v3** — GA since Feb 2026. Most expressive TTS. Audio tags, multi-speaker dialogue, 70+ languages. 68% error reduction on numbers/symbols. |
| `eleven_multilingual_v2` | Multilingual v2 — stable, recommended for real-time/conversational use |
| `eleven_turbo_v2_5` | Turbo v2.5 — lowest latency, real-time |
| `eleven_flash_v2_5` | Flash v2.5 — fastest, lowest cost |

### Eleven v3 Features (GA Feb 2026)
- **Audio tags**: `[excited]`, `[whispers]`, `[sighs]`, `[laughs]` inline in text
- **Multi-speaker dialogue**: New `POST /v1/text-to-dialogue` endpoint
- **70+ languages** with improved accuracy (99% error reduction for phone numbers, chemical formulas)
- Requires more prompt engineering than v2 — not recommended for real-time/low-latency use cases

### Text to Dialogue API (new endpoint)
```json
POST /v1/text-to-dialogue
[
  {"speaker_id": "voice-id-1", "text": "[cheerfully] Hello there!"},
  {"speaker_id": "voice-id-2", "text": "Hey, how are you?"}
]
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
~/.connectors/connect-elevenlabs/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
