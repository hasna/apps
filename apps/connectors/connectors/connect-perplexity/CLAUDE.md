# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-perplexity is a TypeScript CLI and library for Perplexity AI's API. It provides chat completions with web search grounding, supporting multiple Sonar models with citation tracking.

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

# Example commands
bun run dev ask "What is AI?"
bun run dev chat search "latest news"
bun run dev models
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client for Perplexity API
│   ├── example.ts    # ChatApi - chat completions
│   └── index.ts      # Main Perplexity class
├── cli/
│   └── index.ts      # CLI commands (ask, search, chat, config, profile)
├── types/
│   └── index.ts      # Perplexity API types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Key Types

```typescript
// Models available
type PerplexityModel =
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-reasoning'
  | 'sonar-reasoning-pro'
  | 'sonar-deep-research';

// Chat message structure
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Response includes citations
interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  citations?: string[];      // Source URLs
  search_results?: SearchResult[];
}
```

## API Patterns

### ChatApi Methods

- `create(messages, options)` - Full chat completion with message history
- `ask(question, options)` - Simple question/answer
- `search(query, options)` - Web search with answer
- `research(topic, options)` - Deep research (uses sonar-deep-research)
- `reason(prompt, options)` - Reasoning task (uses sonar-reasoning-pro)

### Options

```typescript
interface ChatOptions {
  model?: PerplexityModel;
  maxTokens?: number;
  temperature?: number;
  searchRecencyFilter?: 'month' | 'week' | 'day' | 'hour';
  systemPrompt?: string;
  // ...more
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PERPLEXITY_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-perplexity/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON:
```json
{
  "apiKey": "pplx-xxx",
  "defaultModel": "sonar-pro"
}
```

## CLI Commands

```bash
# Quick commands
connect-perplexity ask <question>
connect-perplexity search <query>
connect-perplexity models

# Chat commands
connect-perplexity chat ask <question> [-m model] [-t temp] [--recency hour|day|week|month]
connect-perplexity chat search <query> [--recency]
connect-perplexity chat research <topic>
connect-perplexity chat reason <prompt>

# Config
connect-perplexity config set-key <key>
connect-perplexity config set-model <model>
connect-perplexity config show

# Profiles
connect-perplexity profile list|use|create|delete|show
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
