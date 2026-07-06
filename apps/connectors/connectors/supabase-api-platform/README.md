# Supabase Api Platform Connector

TypeScript connector for the [Supabase Management API](https://supabase.com/docs/reference/api/introduction).

## Features

- List, create, and get Supabase projects
- List organization audit events
- Search projects via query filters on `GET /projects`
- Raw request passthrough for any Management API endpoint
- Multi-profile configuration with Bearer token auth

## Installation

```bash
bun install
```

## Configuration

```bash
export SUPABASE_API_PLATFORM_ACCESS_TOKEN=your-personal-access-token
# optional
export SUPABASE_API_PLATFORM_BASE_URL=https://api.supabase.com/v1
```

Or use the CLI profile/config commands:

```bash
connect-supabase-api-platform config set-token <token>
connect-supabase-api-platform config set-base-url <url>
```

## CLI Usage

```bash
connect-supabase-api-platform items list
connect-supabase-api-platform items create -d '{"name":"my-project","organization_id":"..."}'
connect-supabase-api-platform items get <project-ref>
connect-supabase-api-platform events list --query organization_slug=my-org
connect-supabase-api-platform search -d '{"name":"demo"}'
connect-supabase-api-platform raw /projects -m GET
```

## Development

```bash
bun run dev items list
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
