# @hasna/connect-zohorecruit

TypeScript connector for the [Zoho Recruit](https://www.zoho.com/recruit/) ATS REST API v2.

## Features

- OAuth access token authentication (`Zoho-oauthtoken`)
- Multi data-center support (`com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`)
- Record CRUD, search, upsert, and delete
- Job-candidate association and status workflows
- Notes, attachments, settings, users, tags, webhooks, and org endpoints
- CLI for common recruiting operations

## Quick Start

```bash
cd connectors/zohorecruit
bun install
export ZOHORECRUIT_TOKEN=your-oauth-access-token
export ZOHORECRUIT_DATA_CENTER=com
bun run dev settings modules
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHORECRUIT_TOKEN` | OAuth access token |
| `ZOHORECRUIT_DATA_CENTER` | Data center (`com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`) |
| `ZOHORECRUIT_BASE_URL` | Optional API base URL override |

## Library Usage

```typescript
import { ZohoRecruit } from '@hasna/connect-zohorecruit';

const recruit = ZohoRecruit.fromEnv();
const candidates = await recruit.listRecords('Candidates', { per_page: 10 });
const jobs = await recruit.listRecords('JobOpenings');
```

## CLI

```bash
zohorecruit config set-token <token>
zohorecruit config set-dc eu
zohorecruit records list Candidates --per-page 20
zohorecruit records search Candidates --email candidate@example.com
zohorecruit jobs candidates <jobId>
zohorecruit settings modules
zohorecruit users
zohorecruit org
```

## OAuth

Zoho Recruit uses Zoho OAuth 2.0. Register a client in the [Zoho API Console](https://api-console.zoho.com/) and request Recruit scopes. Use the `auth` utilities in `src/utils/auth.ts` for the authorization code flow, or set `ZOHORECRUIT_TOKEN` from an existing integration.

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
