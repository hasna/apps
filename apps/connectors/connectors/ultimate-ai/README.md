# connect-ultimate-ai

TypeScript CLI and library for the [Zendesk Ultimate AI](https://www.zendesk.com/ultimate/) support bot platform.

Base URL: `https://api.ultimate.ai/v1`

## Install

```bash
bun install
```

## Authentication

Set a Bearer API key:

```bash
export ULTIMATE_AI_API_KEY=your-api-key
# or
connect-ultimate-ai config set-key your-api-key
```

## Usage

```bash
# List bots
connect-ultimate-ai bots list

# Get a bot
connect-ultimate-ai bots get <botId>

# Create a bot
connect-ultimate-ai bots create --name "Support Bot"

# List events
connect-ultimate-ai events list

# Search
connect-ultimate-ai search --query "shipping policy"

# Raw API request
connect-ultimate-ai raw GET /bots
connect-ultimate-ai raw POST /search --body '{"query":"hello"}'
```

## Development

```bash
bun run dev bots list
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
