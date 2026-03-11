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

## Models (2026)

| Model ID | Description |
|----------|-------------|
| `claude-opus-4-6` | Most intelligent, 200K context (1M beta), 128K max output, adaptive thinking |
| `claude-sonnet-4-6` | Best speed/intelligence balance, 200K context (1M beta), 64K max output |
| `claude-opus-4-20250514` | Claude 4 Opus (2025) |
| `claude-sonnet-4-20250514` | Claude 4 Sonnet (2025) |
| `claude-3-5-haiku-20241022` | Fast and cost-effective |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet |

Default model: `claude-sonnet-4-6`

## Adaptive Thinking (claude-opus-4-6 / claude-sonnet-4-6)

Use adaptive thinking to let Claude decide when and how much to think:

```typescript
const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },           // default effort: high
  thinking: { type: 'adaptive', effort: 'low' },  // less thinking for simple problems
  messages: [{ role: 'user', content: '...' }],
});
```

Note: `thinking: {type: "enabled", budget_tokens: N}` is deprecated on 4.6 models. Use adaptive thinking instead.

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
~/.connectors/connect-anthropic/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
