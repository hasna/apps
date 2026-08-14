# connect-vercel-ai-gateway

TypeScript CLI and library for the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API.

## Features

- Multi-profile API key configuration
- OpenAI-compatible chat completions and embeddings
- Anthropic-compatible messages API
- OpenResponses compatibility endpoint
- Raw request mode with compatibility switching
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/vercel-ai-gateway
bun install

# Configure API key
export VERCEL_AI_GATEWAY_API_KEY=your-key
# or
bun run dev config set-key your-key

# List models
bun run dev models list

# Chat
bun run dev chat "Hello" --model openai/gpt-4o-mini
```

## CLI Commands

```bash
connect-vercel-ai-gateway profile list|use|create|delete|show
connect-vercel-ai-gateway config set-key|show|clear
connect-vercel-ai-gateway models list|get <model>
connect-vercel-ai-gateway chat <message> [--model <model>] [--stream]
connect-vercel-ai-gateway embeddings --model <model> --input <text>
connect-vercel-ai-gateway responses create --model <model> --input <json>
connect-vercel-ai-gateway anthropic --model <model> --message <text>
connect-vercel-ai-gateway raw --path <path> [--compatibility openai|anthropic|openresponses]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_AI_GATEWAY_API_KEY` | API key (overrides profile config) |

## Development

```bash
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## License

Apache-2.0
