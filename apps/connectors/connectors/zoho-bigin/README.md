# connect-zoho-bigin

TypeScript connector for the [Zoho Bigin](https://www.bigin.com/) v2 REST API — lightweight CRM contacts, companies, pipelines, and tasks.

## Features

- OAuth access token authentication (`Zoho-oauthtoken`)
- Multi-profile CLI configuration
- Contacts, companies (Accounts), pipelines, tasks, and raw API access
- Automatic retry on rate limits and server errors

## Quick Start

```bash
cd connectors/zoho-bigin
bun install
export ZOHOBGIN_TOKEN=your-oauth-access-token
bun run dev contacts list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOBGIN_TOKEN` | Zoho OAuth access token |
| `ZOHOBGIN_BASE_URL` | Optional API base URL (default `https://www.zohoapis.com/bigin/v2`) |

## CLI Commands

```bash
# Profile & config
connect-zoho-bigin profile list
connect-zoho-bigin config set-token <token>

# Contacts
connect-zoho-bigin contacts list
connect-zoho-bigin contacts get <id>
connect-zoho-bigin contacts add --last-name Doe --first-name Jane

# Companies (Accounts)
connect-zoho-bigin companies list

# Pipelines & tasks
connect-zoho-bigin pipelines list
connect-zoho-bigin tasks list

# Raw API
connect-zoho-bigin raw request --path /Contacts --method GET
```

## Library Usage

```typescript
import { ZohoBigin } from '@hasna/connect-zoho-bigin';

const bigin = ZohoBigin.fromEnv();
const contacts = await bigin.listContacts({ per_page: 50 });
```

## Development

```bash
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## License

Apache-2.0
