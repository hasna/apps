# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-googlegemini is a TypeScript connector for the Google Gemini API with multi-profile configuration support. It provides CLI and programmatic access to text generation, image generation (Nano Banana), video generation (Veo), text-to-speech, and embeddings.

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
| `gemini-3.1-pro-preview` | Latest (Feb 2026), #1 on 13/16 benchmarks, 1M ctx — **use for complex tasks** |
| `gemini-3.1-pro-preview-customtools` | Agent workflows with custom tools (bash, code, multi-step) |
| `gemini-3.1-flash-lite` | Fast, budget-friendly (preview) |
| `gemini-3-pro-preview` | Gemini 3 Pro |
| `gemini-3-flash-preview` | Frontier performance at fraction of cost |
| `gemini-2.5-pro` | GA, advanced reasoning (discontinues Jun 17 2026) |
| `gemini-2.5-flash` | Best price-performance, GA |
| `gemini-2.5-flash-lite` | Fastest, most budget-friendly |
| `gemini-2.5-flash-live-preview` | Real-time audio/video Live API |

For image gen (Nano Banana): `gemini-2.5-flash-preview-image-generation`
For video gen (Veo): `veo-3.1-generate-preview`
For TTS: `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-googlegemini config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connectors/connect-googlegemini/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses API key authentication via URL parameter. API key can be set via:
- Environment variable: `GEMINI_API_KEY`
- Profile configuration: `connect-googlegemini config set api-key <key>`

### API Modules

- **GenerateApi**: Text generation with streaming support
- **ImagesApi**: Image generation and editing (Nano Banana)
- **VideoApi**: Video generation with long-running operations (Veo)
- **SpeechApi**: Text-to-speech with 30 voices
- **EmbeddingsApi**: Text embeddings with similarity calculation
- **FilesApi**: File upload and management
- **ModelsApi**: Model listing and info

### Long-Running Operations

Video generation uses long-running operations:
1. Start generation with `predictLongRunning`
2. Poll operation status until `done: true`
3. Extract video from response

## API Modules

- **GenerateApi**: Text generation with streaming support
- **ImagesApi**: Image generation and editing (Nano Banana)
- **VideoApi**: Video generation with long-running operations (Veo)
- **SpeechApi**: Text-to-speech with 30 voices
- **EmbeddingsApi**: Text embeddings with similarity calculation
- **FilesApi**: File upload and management
- **ModelsApi**: Model listing and info

### Long-Running Operations

Video generation uses long-running operations:
1. Start generation with `predictLongRunning`
2. Poll operation status until `done: true`
3. Extract video from response

## CLI Commands

### Text Generation
```bash
connect-googlegemini ask <prompt>                  # Quick text
connect-googlegemini generate text <prompt>        # With options
connect-googlegemini generate json <prompt>        # JSON output
connect-googlegemini generate tokens <text>        # Count tokens
```

### Image Generation (Nano Banana)
```bash
connect-googlegemini image generate <prompt>       # Generate
connect-googlegemini image edit <img> <instruction> # Edit
connect-googlegemini image describe <img>          # Vision
```

### Video Generation (Veo)
```bash
connect-googlegemini video generate <prompt>       # Generate
connect-googlegemini video status <op>             # Status
connect-googlegemini video models                  # List
```

### Speech
```bash
connect-googlegemini speech generate <text>        # TTS
connect-googlegemini speech voices                 # List
```

### Embeddings
```bash
connect-googlegemini embed text <text>             # Embed
connect-googlegemini embed similarity <t1> <t2>    # Compare
```

### Files
```bash
connect-googlegemini files list                    # List
connect-googlegemini files upload <path>           # Upload
connect-googlegemini files delete <name>           # Delete
```

### Models
```bash
connect-googlegemini models list                   # All models
connect-googlegemini models info <model>           # Model info
```

### Profile & Config
```bash
connect-googlegemini profile list                  # List
connect-googlegemini profile use <name>            # Switch
connect-googlegemini config set api-key <key>      # Set key
connect-googlegemini config show                   # Show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_BASE_URL` | Base URL override |

## Data Storage

```
~/.connectors/connect-googlegemini/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
