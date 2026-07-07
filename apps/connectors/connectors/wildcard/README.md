# Wildcard Connector

TypeScript CLI and library for the [Wildcard API](https://docs.wild-card.ai/) — AI tool discovery, endpoint search, and agents.json flow execution.

## Install

```bash
bun install
```

## Configure

```bash
set WILDCARD_API_KEY in your shell before running commands
# optional
export WILDCARD_DEFAULT_COLLECTION_ID=your_collection_id
export WILDCARD_BASE_URL=https://api.wild-card.ai
```

Or use the CLI profile/config commands (stored under `~/.hasna/connectors/connect-wildcard/`).

## Usage

```bash
# Tool discovery
bun run dev search-tools "send a Slack message"
bun run dev get-flow send_slack_message --collection-id collection_1

# Endpoint search
bun run dev search-endpoints "gmail search" --q2 "find emails" --index-name private_tools
bun run dev list-public-tools --limit 20
bun run dev get-action-schema gmail_users_messages_list

# agents.json flows
bun run dev list-flows --agents-json-file ./agents.json
bun run dev create-flow-prompt --agents-json-file ./agents.json
bun run dev invoke-flow create_contact --agents-json-file ./agents.json \
  --parameters '{"name":"Ada"}' --request-body '{"email":"ada@example.com"}'

# Raw API access
bun run dev raw-request --method POST --path /query/tools --body '{"dry_run":true}'
```

## Library

```typescript
import { Wildcard } from '@hasna/connect-wildcard';

const client = new Wildcard({
  apiKey: process.env.WILDCARD_API_KEY!,
  defaultCollectionId: 'my_collection',
});

const tools = await client.search.searchTools({ query: 'calendar events' });
const result = await client.flows.invokeFlow({
  agents_json_url: 'https://example.com/agents.json',
  flow_id: 'my_flow',
  parameters: { q: 'hello' },
});
```

## Docs

- API reference: https://docs.wild-card.ai/api-ref/search/tool-selection
- Auth: API key via `X-API-Key` header

## License

Apache-2.0
