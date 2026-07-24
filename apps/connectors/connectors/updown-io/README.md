# @hasna/connect-updown-io

TypeScript connector for the [updown.io](https://updown.io) website monitoring API.

## Features

- List and inspect uptime checks
- Downtime history and performance metrics
- Monitoring node and IP discovery
- Multi-profile CLI configuration
- API key authentication via `X-API-KEY` header

## Quick Start

```bash
cd connectors/updown-io
bun install
export UPDOWN_IO_API_KEY=your-api-key
bun run dev checks list
```

## CLI

```bash
bun run dev checks list
bun run dev checks get <token> [--metrics] [--results]
bun run dev downtimes list <token> [--page 1] [--results]
bun run dev metrics get <token> [--from <time>] [--to <time>] [--group time|host]
bun run dev nodes list
bun run dev nodes ips [--format json|txt]
bun run dev config set-key <key>
bun run dev profile list
```

## Environment

| Variable | Description |
|----------|-------------|
| `UPDOWN_IO_API_KEY` | updown.io API key |

## API Reference

- Documentation: https://updown.io/doc
- API base URL: https://updown.io/api

## License

Apache-2.0
