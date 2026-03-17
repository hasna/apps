# connect-perplexity

A TypeScript CLI and library for interacting with Perplexity AI's API. Chat completions with web search grounding.

## Features

- Chat completions with web search grounding
- Multiple Sonar models (sonar, sonar-pro, sonar-reasoning, sonar-deep-research)
- Citations and source tracking
- Multi-profile configuration (switch between different API keys)
- Pretty and JSON output formats

## Installation

```bash
# Install globally
bun add -g @hasna/connect-perplexity

# Or install locally
bun add @hasna/connect-perplexity
```

## Setup

### Get API Key

1. Go to [Perplexity AI Settings](https://www.perplexity.ai/settings/api)
2. Create an API key
3. Set it in the CLI:

```bash
connect-perplexity config set-key pplx-xxxxx

# Or use environment variable
export PERPLEXITY_API_KEY=pplx-xxxxx
```

## CLI Usage

### Quick Commands

```bash
# Ask a question
connect-perplexity ask "What is quantum computing?"

# Search the web
connect-perplexity search "latest AI news 2026"

# List available models
connect-perplexity models
```

### Chat Commands

```bash
# Ask with specific model
connect-perplexity chat ask "Explain neural networks" -m sonar-pro

# Search with recency filter
connect-perplexity chat search "Bitcoin price" --recency day

# Deep research on a topic
connect-perplexity chat research "Climate change solutions"

# Reasoning task
connect-perplexity chat reason "If all A are B, and all B are C, what can we conclude?"
```

### Profile Management

```bash
# Create profiles for different API keys
connect-perplexity profile create work --api-key pplx-xxx --use
connect-perplexity profile create personal --api-key pplx-yyy

# Switch profiles
connect-perplexity profile use work

# Use profile for single command
connect-perplexity -p personal ask "Hello"

# List profiles
connect-perplexity profile list
```

### Configuration

```bash
# Set API key
connect-perplexity config set-key <key>

# Set default model
connect-perplexity config set-model sonar-pro

# Show configuration
connect-perplexity config show
```

## Library Usage

```typescript
import { Perplexity } from '@hasna/connect-perplexity';

// Create client
const perplexity = new Perplexity({ apiKey: 'pplx-xxx' });

// Or from environment
const perplexity = Perplexity.fromEnv(); // Uses PERPLEXITY_API_KEY

// Ask a question
const response = await perplexity.chat.ask('What is quantum computing?');
console.log(response.choices[0].message.content);

// With options
const response = await perplexity.chat.ask('Explain AI', {
  model: 'sonar-pro',
  temperature: 0.7,
  maxTokens: 1000,
});

// Search the web
const search = await perplexity.chat.search('latest AI news');
console.log(search.citations); // Array of source URLs

// Deep research
const research = await perplexity.chat.research('Climate change impacts');

// Reasoning
const reason = await perplexity.chat.reason('Solve this logic puzzle...');

// Full chat with messages
const chat = await perplexity.chat.create([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
], { model: 'sonar' });
```

## Models

| Model | Description |
|-------|-------------|
| `sonar` | Standard model for general queries |
| `sonar-pro` | Enhanced model with better accuracy |
| `sonar-reasoning` | Optimized for reasoning tasks |
| `sonar-reasoning-pro` | Enhanced reasoning model |
| `sonar-deep-research` | Comprehensive research model |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PERPLEXITY_API_KEY` | API key (overrides profile config) |

## Data Storage

Configuration stored in `~/.connect/connect-perplexity/`:

```
~/.connect/connect-perplexity/
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

MIT
