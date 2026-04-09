# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-mistral is a TypeScript CLI and library for Mistral AI's API. It provides chat completions, code generation with Codestral, and embeddings with multi-profile support.

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
| `mistral-large-latest` | Large 3 (Dec 2025), top-tier |
| `mistral-medium-latest` | Medium 3.1 (Aug 2025), multimodal — **recommended default** |
| `magistral-medium-latest` | Magistral 1.2 (Sep 2025), reasoning + vision, 40K ctx |
| `codestral-latest` | Codestral 2508, code specialist, 256K context |
| `devstral-latest` | Devstral Medium, coding agents, multi-file editing |
| `ministral-8b-latest` | Edge model, fast and cheap |
| `ministral-3b-latest` | Fastest edge model |

New capabilities (2025-2026):
- **OCR / Document AI**: `mistral-ocr-2512` via `POST /v1/ocr`
- **Audio transcription**: `voxtral-mini-2602` via `POST /v1/audio/transcriptions` (with diarize, context biasing)
- **Reasoning**: Magistral series with extended thinking
- **Coding agents**: Devstral for multi-file codebase exploration

Default: `mistral-medium-latest`

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-mistral config set-key <key>`


## CLI Commands

```bash
# Quick commands
connect-mistral ask <question>
connect-mistral models

# Chat commands
connect-mistral chat ask <question> [-m model] [-t temp] [--safe]
connect-mistral chat code <prompt>
connect-mistral chat json <prompt>

# Embeddings
connect-mistral embed create <text>

# Config
connect-mistral config set-key <key>
connect-mistral config set-model <model>
connect-mistral config show

# Profiles
connect-mistral profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-mistral/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
