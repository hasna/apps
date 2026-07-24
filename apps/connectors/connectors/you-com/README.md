# @hasna/connect-you-com

You.com Web Search and Research API connector for the open-connectors monorepo.

## Features

- **Web Search** — LLM-ready results from `GET/POST https://ydc-index.io/v1/search`
- **Deep Research** — Citation-backed answers from `POST https://api.you.com/v1/research`
- **CLI** — `search`, `search-post`, `research`, config, and profile commands
- **Library** — TypeScript client with typed request/response interfaces

## Setup

```bash
cd connectors/you-com
bun install
export YDC_API_KEY="your-api-key"  # https://you.com/platform/api-keys
```

Or persist the key in a profile:

```bash
bun run dev config set-key your-api-key
```

## Usage

```bash
# Simple web search
connect-you-com search "global birth rate trends" --count 5

# Search with domain allowlist (POST)
connect-you-com search-post "cloud providers" \
  --include-domains aws.amazon.com,cloud.google.com \
  --count 10

# Deep research with citations
connect-you-com research "microservices vs monolith tradeoffs for high traffic" \
  --effort standard

# JSON output
connect-you-com search "AI news" -f json
```

## Library

```typescript
import { YouCom } from '@hasna/connect-you-com';

const client = new YouCom({ apiKey: process.env.YDC_API_KEY! });

const search = await client.search.get({ query: 'latest AI news', count: 5 });
const research = await client.research.create({
  input: 'Compare top three cloud providers',
  research_effort: 'standard',
});
```

## Documentation

- You.com API docs: https://you.com/docs
- Search reference: https://you.com/docs/api-reference/search/v1-search
- Research reference: https://you.com/docs/api-reference/research/v1-research

## License

Apache-2.0
