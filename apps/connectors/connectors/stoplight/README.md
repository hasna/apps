# connect-stoplight

TypeScript connector for the [Stoplight](https://stoplight.io/) REST API. Manage projects, events, and search across your API design workspace.

## Features

- Bearer token authentication with multi-profile support
- Projects: list, get, create
- Events: list
- Search API
- Raw request escape hatch for undocumented v1 endpoints

## Limitations

Stoplight API v1 is partially undocumented and some operations may be plan-gated. This connector implements the documented inventory endpoints only.

## Quick Start

```bash
cd connectors/stoplight
bun install
bun run dev auth status
```

## Authentication

Get an API key from your Stoplight account settings, then:

```bash
connect-stoplight auth login <your-api-key>
# or
export STOPLIGHT_API_KEY=your-api-key-here
```

Optional custom base URL:

```bash
export STOPLIGHT_BASE_URL=https://api.stoplight.io/v1
connect-stoplight config set-base-url https://api.stoplight.io/v1
```

## CLI Commands

```bash
# Auth
connect-stoplight auth login <key>
connect-stoplight auth logout
connect-stoplight auth status

# Profiles
connect-stoplight profile list
connect-stoplight profile create <name> --api-key <key>
connect-stoplight profile use <name>

# Projects
connect-stoplight project list
connect-stoplight project get <projectId>
connect-stoplight project create --body '{"name":"My API"}'

# Events
connect-stoplight event list

# Search
connect-stoplight search run --body '{"query":"users"}'

# Raw API
connect-stoplight raw /projects --method GET
```

## Library Usage

```typescript
import { Stoplight } from '@hasna/connect-stoplight';

const client = new Stoplight({
  apiKey: process.env.STOPLIGHT_API_KEY!,
});

const projects = await client.listProjects();
```

## Data Storage

```
~/.hasna/connectors/connect-stoplight/
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
