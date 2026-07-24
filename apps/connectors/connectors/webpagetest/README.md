# WebPageTest Connector

TypeScript connector for the [WebPageTest](https://www.webpagetest.org/) performance testing platform.

## Features

- REST API (`https://api.webpagetest.org/v1`) for tests, events, and search
- Classic PHP API (`runtest.php`, `testStatus.php`, `jsonResult.php`) for submission workflows
- `X-WPT-API-KEY` header authentication per official WebPageTest docs
- Multi-profile configuration under `~/.hasna/connectors/connect-webpagetest/`
- CLI and programmatic library API

## Install

```bash
bun install
bun run build
```

## Authentication

Generate an API key from [WebPageTest API Consumers](https://www.webpagetest.org/account#api-consumers).

```bash
connect-webpagetest config set-api-key <your-api-key>
# or
export WEBPAGETEST_API_KEY=your-api-key
```

## CLI Examples

```bash
connect-webpagetest tests list
connect-webpagetest tests create --url https://example.com --location ec2-us-east-1
connect-webpagetest tests get 240101_AB_cd
connect-webpagetest events list
connect-webpagetest search --query "example.com"
connect-webpagetest classic run --url https://example.com
connect-webpagetest classic status 240101_AB_cd
connect-webpagetest raw-request --path /tests --method GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBPAGETEST_API_KEY` | API key |
| `WEBPAGETEST_BASE_URL` | REST API base URL (default `https://api.webpagetest.org/v1`) |
| `WEBPAGETEST_CLASSIC_BASE_URL` | Classic API host (default `https://www.webpagetest.org`) |

## Development

```bash
bun run dev tests list
bun run typecheck
bun test
```

## License

Apache-2.0
