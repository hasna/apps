# @hasna/connect-yousearch

You.com Search API connector — web search and multi-step research.

## Install

```bash
bun install
```

## Configuration

```bash
# Set API key (get one at https://you.com/platform)
connect-yousearch config set-key <your-api-key>

# Or use environment variable
export YOUSEARCH_API_KEY=your-api-key
```

## Usage

```bash
# Web search (GET)
connect-yousearch search "latest AI news" --count 5

# Web search with domain filters (POST)
connect-yousearch search-post "agent frameworks" --include-domains "example.com,github.com"

# Multi-step research
connect-yousearch research "What are the latest developments in AI agents?" --effort deep

# Raw API request
connect-yousearch raw-request /v1/search -X GET
```

## Library

```typescript
import { YouSearch } from '@hasna/connect-yousearch';

const client = YouSearch.fromEnv();

const results = await client.search.search({ query: 'alumia', count: 5 });
const research = await client.research.research({ input: 'Explain quantum computing' });
```

## API Reference

- [Search API](https://you.com/docs/api-reference/search/v1-search)
- [Research API](https://you.com/docs/api-reference/research/v1-research)

## License

Apache-2.0
