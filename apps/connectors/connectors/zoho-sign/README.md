# Zoho Sign Connector

TypeScript connector for the [Zoho Sign](https://www.zoho.com/sign/) electronic signature REST API.

## Features

- OAuth token authentication (`Zoho-oauthtoken`)
- Multi data-center routing (`com`, `eu`, `in`, `com.au`, `jp`, `ca`)
- Document requests, templates, folders, users, webhooks, and account APIs
- CLI with profile-based configuration

## Installation

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Description |
|----------|-------------|
| `ZOHO_SIGN_TOKEN` | Zoho OAuth access token |
| `ZOHO_SIGN_DATA_CENTER` | Data center (`com`, `eu`, `in`, `com.au`, `jp`, `ca`) |
| `ZOHO_SIGN_BASE_URL` | Optional API base URL override |

Profiles are stored under `~/.hasna/connectors/connect-zoho-sign/profiles/`.

## CLI

```bash
bun run dev config set-token <token>
bun run dev request list
bun run dev template list
bun run dev folder list
bun run dev user list
bun run dev webhook list
bun run dev account
```

## Library

```typescript
import { ZohoSign } from '@hasna/connect-zoho-sign';

const sign = ZohoSign.fromEnv();
const requests = await sign.listRequests();
```

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
