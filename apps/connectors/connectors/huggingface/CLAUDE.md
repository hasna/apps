# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

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

## API Updates (2025-2026)

### Serverless Inference API — Overhauled (2026)
The Serverless Inference API is being completely overhauled. Key changes:

New router endpoint pattern:
```
https://router.huggingface.co/hf-inference/models/{model}/v1/chat/completions
```

For chat completions (OpenAI-compatible):
```bash
curl -X POST https://router.huggingface.co/hf-inference/models/meta-llama/Llama-3.1-8B-Instruct/v1/chat/completions \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "meta-llama/Llama-3.1-8B-Instruct", "messages": [{"role": "user", "content": "Hello"}]}'
```

Note: Error responses may return HTML 503 during migration period — handle non-JSON responses gracefully.

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-huggingface config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/huggingface/profiles/`:
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
~/.hasna/connectors/connect-huggingface/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
