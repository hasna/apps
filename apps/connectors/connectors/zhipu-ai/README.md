# @hasna/connect-zhipu-ai

TypeScript connector for the [Zhipu AI (GLM)](https://open.bigmodel.cn/) Open Platform API.

## Features

- OpenAI-compatible chat completions (`/chat/completions`)
- Model listing and details (`/models`)
- Web Search API (`/web_search`)
- Multi-profile configuration
- Bearer token authentication
- Pretty and JSON output formats

## Quick Start

```bash
# Install dependencies
bun install

# Set API key
bun run dev config set-key <your-api-key>

# Or use environment variable
export ZHIPU_AI_API_KEY=your-api-key-here

# Chat with GLM-5.2
bun run dev chat "Hello, world!"

# List models
bun run dev models

# Get model details
bun run dev model glm-5.2

# Search
bun run dev search "latest AI news"
```

## CLI Commands

```bash
connect-zhipu-ai [options] [command]

Options:
  -f, --format <format>    Output format (json, pretty)
  -p, --profile <profile>  Use a specific profile

Commands:
  profile list             List all profiles
  profile use <name>       Switch to a profile
  profile create <name>    Create a new profile
  profile delete <name>    Delete a profile
  profile show [name]      Show profile configuration

  config set-key <key>     Set API key for active profile
  config show              Show current configuration
  config clear             Clear configuration

  chat <message>           Send a chat message (default model: glm-5.2)
  models                   List available models
  model <id>               Get model details
  search <query>           Search via Zhipu AI search API
```

## Library Usage

```typescript
import { ZhipuAi } from '@hasna/connect-zhipu-ai';

const client = ZhipuAi.fromEnv();

const response = await client.chat({
  model: 'glm-5.2',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0]?.message?.content);

const models = await client.listModels();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZHIPU_AI_API_KEY` | API key (overrides profile config) |
| `ZHIPU_AI_BASE_URL` | Override base URL (default: `https://api.z.ai/api/paas/v4`) |

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## License

Apache-2.0
