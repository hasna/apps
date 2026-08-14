# CLAUDE.md

This file provides guidance to Claude Code when working with the WebPageTest connector.

## Project Overview

connect-webpagetest is a TypeScript connector for WebPageTest performance testing APIs. It supports the REST v1 API and classic PHP endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

WebPageTest requires the API key in the `X-WPT-API-KEY` HTTP header. Do not pass the legacy `k=` query parameter.

## API Surfaces

- REST: `https://api.webpagetest.org/v1` — `/tests`, `/events`, `/search`
- Classic: `https://www.webpagetest.org` — `runtest.php`, `testStatus.php`, `jsonResult.php`

## CLI Commands

- `config set-api-key/set-base-url/set-classic-base-url/show/clear`
- `profile list/use/create/delete`
- `tests list/create/get`
- `events list`
- `search`
- `classic run/status/result`
- `raw-request`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBPAGETEST_API_KEY` | API key |
| `WEBPAGETEST_BASE_URL` | REST API base URL |
| `WEBPAGETEST_CLASSIC_BASE_URL` | Classic API host |

## Data Storage

```
~/.hasna/connectors/connect-webpagetest/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.webpagetest.org/v1",
  "classicBaseUrl": "https://www.webpagetest.org"
}
```
