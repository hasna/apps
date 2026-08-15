# Wiz Connector

TypeScript API connector for the [Wiz](https://www.wiz.io/) cloud security platform.

## Features

- Bearer token authentication (`WIZ_API_KEY`)
- Optional custom API base URL (`WIZ_BASE_URL`, default `https://api.wiz.io/v1`)
- Issues, events, search, and raw request operations
- Multi-profile CLI configuration
- JSON and pretty output formats

## Quick Start

```bash
cd connectors/wiz
bun install
set WIZ_API_KEY in your shell before running commands
bun run dev issues list
```

## CLI Commands

```bash
wiz profile list
wiz config set-key <api-key>
wiz config set-base-url <url>
wiz issues list [--limit N]
wiz issues get <issueId>
wiz issues create --body '{"title":"Example"}'
wiz events list [--limit N]
wiz search --query 'severity:HIGH'
wiz raw-request --path /issues -X GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WIZ_API_KEY` | Wiz API bearer token |
| `WIZ_BASE_URL` | Optional API base URL override |

## API Reference

- https://docs.wiz.io

## License

Apache-2.0
