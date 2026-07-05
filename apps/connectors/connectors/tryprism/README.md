# @hasna/connect-tryprism

TypeScript connector for the [TryPrism](https://tryprism.com) API — AI-native recruiting searches, candidates, and shortlists.

## Install

```bash
bun install
```

## Authentication

Set your API key via environment variable or CLI profile:

```bash
export TRYPRISM_API_KEY=your_api_key
# or
connect-tryprism config set-key your_api_key
```

## CLI Usage

```bash
# Searches
connect-tryprism searches list --limit 10
connect-tryprism searches get <searchId>
connect-tryprism searches create --title "Founding engineer" --location Remote

# Candidates
connect-tryprism candidates list --search-id <searchId>
connect-tryprism candidates get <candidateId>
connect-tryprism candidates feedback <candidateId> --rating strong_yes

# Shortlists
connect-tryprism shortlists list
connect-tryprism shortlists get <shortlistId>

# Raw API escape hatch
connect-tryprism raw --path /searches --method POST --body '{"title":"Custom"}'
```

## Library Usage

```typescript
import { TryPrism } from '@hasna/connect-tryprism';

const client = TryPrism.fromEnv();
const searches = await client.listSearches({ limit: 10 });
```

## Development

```bash
bun run dev -- searches list
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
