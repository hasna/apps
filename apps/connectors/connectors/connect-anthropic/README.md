# connect-anthropic

Anthropic API connector CLI - Claude models for chat and code generation

## Installation

```bash
bun install -g @hasna/connect-anthropic
```

## Quick Start

```bash
# Set your API key
connect-anthropic config set-key YOUR_API_KEY

# Or use environment variable
export ANTHROPIC_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-anthropic profile create work --api-key xxx --use
connect-anthropic profile create personal --api-key yyy

# Switch profiles
connect-anthropic profile use work

# Use profile for single command
connect-anthropic -p personal <command>

# List profiles
connect-anthropic profile list
```

## Models (2026)

| Model ID | Context | Description |
|----------|---------|-------------|
| `claude-opus-4-6` | 200K (1M beta) | Most intelligent, adaptive thinking |
| `claude-sonnet-4-6` | 200K (1M beta) | Best speed/intelligence balance |
| `claude-opus-4-20250514` | 200K | Claude 4 Opus |
| `claude-sonnet-4-20250514` | 200K | Claude 4 Sonnet |
| `claude-3-5-haiku-20241022` | 200K | Fast, cost-effective |

Default: `claude-sonnet-4-6`

## Library Usage

```typescript
import { Anthropic } from '@hasna/connect-anthropic';

const client = new Anthropic({ apiKey: 'YOUR_API_KEY' });

// Basic chat
const response = await client.chat('Explain quantum computing');

// With adaptive thinking (claude-opus-4-6 / claude-sonnet-4-6)
const response = await client.chat('Solve this hard problem', {
  model: 'claude-opus-4-6',
  thinking: { type: 'adaptive' },
  maxTokens: 16000,
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key |

## Data Storage

Configuration stored in `~/.connectors/connect-anthropic/`:

```
~/.connectors/connect-anthropic/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

Apache-2.0
