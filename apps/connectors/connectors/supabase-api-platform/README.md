# Supabase Api Platform Connector

TypeScript connector for the [Supabase Management API](https://supabase.com/docs/reference/api/introduction).

## Features

- List, create, and get Supabase projects
- Raw request passthrough for any Management API endpoint
- Multi-profile configuration with Bearer token auth

## Installation

```bash
bun install
```

## Configuration

Set the access token environment variable to a Supabase personal access token.
Optionally set the base URL environment variable when using a non-default Management API URL.

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
