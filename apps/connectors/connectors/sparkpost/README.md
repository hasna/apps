# @hasna/connect-sparkpost

TypeScript connector for the SparkPost transactional email API.

## Features

- Multi-profile configuration with US/EU region support
- Raw API key authentication (SparkPost standard)
- CLI and library access
- Pretty and JSON output formats

## Quick Start

```bash
bun install
bun run dev config set-key <your-api-key>
bun run dev transmission send --to user@example.com --from sender@example.com --subject "Hello" --html "<p>Hi</p>"
```

## CLI Commands

```bash
connect-sparkpost [options] [command]

Options:
  -k, --api-key <key>      API key (overrides config)
  -r, --region <region>    API region (us or eu)
  -f, --format <format>    Output format (json, pretty)
  -p, --profile <profile>  Use a specific profile

Commands:
  profile list|use|create|delete|show
  config set-key|set-region|show|clear
  transmission send|ls|get|delete
  template ls|get|create|delete
  domain ls|get|create|verify|delete
  suppression ls|add|delete
  webhook ls|create|delete
  recipient-list ls|create
  account show
  events ls
  validate email <address>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPARKPOST_API_KEY` | API key |
| `SPARKPOST_REGION` | `us` (default) or `eu` |

## License

Apache-2.0
