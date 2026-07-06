# @hasna/connect-stoplight-api-platform

A TypeScript connector (CLI + library) for the [Stoplight](https://stoplight.io)
API design, documentation, and governance platform.

## Features

- Multi-profile configuration (switch between different tokens/accounts)
- Workspace token / personal access token authentication
- Workspaces, projects, branches, members, groups, and documentation nodes
- Pretty, table, and JSON output formats
- TypeScript with strict mode, minimal dependencies (commander, chalk)

## Installation

```bash
bun install
bun run build
```

## Authentication

Create a **Workspace Token** (read-only) or a **Personal Access Token** in your
Stoplight workspace settings. The token is sent verbatim in the `Authorization`
header (no `Bearer` prefix).

```bash
# Save the token to the active profile
connect-stoplight-api-platform config set-token <your-token>

# Or use an environment variable
export STOPLIGHT_API_TOKEN=<your-token>
```

To point at a self-hosted / on-prem instance:

```bash
connect-stoplight-api-platform config set-base-url https://stoplight.example.com/api
# or STOPLIGHT_BASE_URL=...
```

## CLI Usage

```bash
# Workspaces
connect-stoplight-api-platform workspace projects <workspaceId>
connect-stoplight-api-platform workspace groups <workspaceId>

# Projects
connect-stoplight-api-platform project get <projectId>
connect-stoplight-api-platform project branches <projectId>
connect-stoplight-api-platform project members <projectId>
connect-stoplight-api-platform project toc <projectId> --branch main

# Nodes (OpenAPI / models / markdown)
connect-stoplight-api-platform node get <workspaceSlug> <projectSlug> --uri /reference/api.yaml
connect-stoplight-api-platform node export <workspaceSlug> <projectSlug> --uri /reference/api.yaml

# Output format
connect-stoplight-api-platform project get <projectId> --format json
```

## Library Usage

```ts
import { Stoplight } from '@hasna/connect-stoplight-api-platform';

const stoplight = Stoplight.fromEnv(); // reads STOPLIGHT_API_TOKEN

const projects = await stoplight.listWorkspaceProjects('workspaceId');
const project = await stoplight.getProject('projectId');
const toc = await stoplight.getTableOfContents('projectId');
const spec = await stoplight.exportBundledNode('acme', 'my-api', '/reference/api.yaml');
```

## Development

```bash
bun run dev <command>   # run the CLI from source
bun run typecheck       # tsc --noEmit
bun test                # run unit tests
```

## License

Apache-2.0
