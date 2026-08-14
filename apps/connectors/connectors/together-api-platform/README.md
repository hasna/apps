# Together Api Platform Connector

TypeScript connector for the [Together Api Platform](https://www.ycombinator.com/companies/together-api-platform) REST API.

## Features

- List, create, and get items
- List events
- Search API
- Raw request passthrough for any endpoint
- Multi-profile configuration with Bearer token auth

## Installation

```bash
bun install
```

## Configuration

```bash
export TOGETHER_API_PLATFORM_API_KEY=your-api-key
# optional
export TOGETHER_API_PLATFORM_BASE_URL=https://api.togetherapiplatform.com/v1
```

Or use the CLI profile/config commands:

```bash
connect-together-api-platform config set-key <api-key>
connect-together-api-platform config set-base-url <url>
```

## CLI Usage

```bash
connect-together-api-platform items list
connect-together-api-platform items create -d '{"name":"example"}'
connect-together-api-platform items get item-1
connect-together-api-platform events list
connect-together-api-platform search -d '{"q":"example"}'
connect-together-api-platform raw /items -m GET
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
