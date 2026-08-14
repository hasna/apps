# @hasna/connect-zatanna

TypeScript connector for the [Zatanna](https://zatanna.ai) AI workflow automation API.

## Features

- Search, discover, invoke, and export workflows
- Run status and event polling
- Capture replay for recorded sessions
- Multi-profile configuration with API key auth
- Custom auth header and base URL support

## Quick Start

```bash
cd connectors/zatanna
bun install
bun run dev config set-key <your-api-key>
bun run dev workflows search --query "claims portal"
```

## Authentication

API key via Bearer token (default) or custom header:

| Variable | Description |
|----------|-------------|
| `ZATANNA_API_KEY` | API key (overrides profile) |
| `ZATANNA_BASE_URL` | API base URL (default `https://api.zatanna.ai/v1`) |
| `ZATANNA_AUTH_HEADER` | Custom auth header name |
| `ZATANNA_DEFAULT_WORKSPACE_ID` | Default workspace for queries |

Profiles are stored in `~/.hasna/connectors/connect-zatanna/profiles/`.

## CLI Commands

```bash
connect-zatanna workflows search --query "claims portal"
connect-zatanna workflows discover --query "submit a freight claim"
connect-zatanna workflows get <workflow-id>
connect-zatanna workflows invoke <workflow-id> --input '{"claimId":"CLM-1"}'
connect-zatanna workflows export <workflow-id> --format mcp
connect-zatanna runs status <run-id>
connect-zatanna runs events <run-id>
connect-zatanna captures replay <capture-id>
```

## Library Usage

```typescript
import { Zatanna } from '@hasna/connect-zatanna';

const client = new Zatanna({
  apiKey: process.env.ZATANNA_API_KEY!,
  defaultWorkspaceId: 'workspace_default',
});

const workflows = await client.workflows.searchWorkflows({ query: 'claims portal' });
const run = await client.workflows.invokeWorkflow({
  workflowId: 'submit-claim',
  input: { claimId: 'CLM-1' },
});
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
