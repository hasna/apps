# Trellis Tech Connector

TypeScript connector for the [Trellis Tech Public REST API v1](https://docs.trellistech.com/api-reference).

## Authentication

Create a workspace API key in Trellis (Settings > Developer). The key uses Bearer authentication and must match the configured workspace ID.

```bash
export TRELLISTECH_API_KEY=your-api-key
export TRELLISTECH_WORKSPACE_ID=your-workspace-id
```

## CLI

```bash
bun install
bun run dev config set-key <api-key>
bun run dev config set-workspace <workspace-id>

# Properties
bun run dev properties list
bun run dev properties get <propertyId>
bun run dev properties create --name "Casa Duomo"

# Tasks
bun run dev tasks list --status OPEN
bun run dev tasks create --title "Replace bulb" --department-id <uuid>
```

## Library

```typescript
import { Trellistech } from '@hasna/connect-trellistech';

const client = Trellistech.fromEnv();
const properties = await client.properties.list({ status: 'ACTIVE' });
const task = await client.tasks.get('task-uuid');
```

## API coverage

- `GET/POST /workspaces/{workspaceId}/properties`
- `GET/PATCH/PUT/DELETE /workspaces/{workspaceId}/properties/{propertyId}`
- `GET/POST /workspaces/{workspaceId}/tasks`
- `GET/PATCH/PUT/DELETE /workspaces/{workspaceId}/tasks/{taskId}`

Base URL: `https://app.trellistech.com/api/v1`

## Development

```bash
bun run typecheck
bun test
bun run build
```
