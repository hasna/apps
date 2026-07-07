# connect-upstash-api-platform

TypeScript connector for the [Upstash Developer API](https://upstash.com/docs/devops/developer-api/introduction). Manage teams, vector indices, and audit logs from the CLI or programmatically.

This package covers platform-wide management endpoints (`https://api.upstash.com/v2`). Redis database and Kafka topic CRUD live in the separate `upstash` connector.

## Install

```bash
bun install
bun run build
```

## Authentication

Upstash uses HTTP Basic authentication with your account email as the username and a [management API key](https://upstash.com/docs/devops/developer-api/authentication) as the password.

```bash
connect-upstash-api-platform auth set-email you@example.com
connect-upstash-api-platform auth set-key YOUR_MANAGEMENT_API_KEY
connect-upstash-api-platform auth status
```

Environment overrides:

- `UPSTASH_EMAIL`
- `UPSTASH_API_KEY`

## CLI examples

```bash
# Teams
connect-upstash-api-platform team list
connect-upstash-api-platform team create my-team --copy-cc
connect-upstash-api-platform team members <team-id>

# Vector indices
connect-upstash-api-platform vector list
connect-upstash-api-platform vector get <index-id>
connect-upstash-api-platform vector create --name my-index --region us-east-1 --similarity COSINE --dimensions 384
connect-upstash-api-platform vector delete <index-id>

# Audit logs
connect-upstash-api-platform account audit-logs

# Raw request
connect-upstash-api-platform raw request --method GET --path /teams
connect-upstash-api-platform raw request --method GET --path /auditlogs --base-url https://api.upstash.com
```

Output redacts token and credential fields by default. Use `--show-secrets` only when you intentionally need raw service tokens in stdout.

## Library usage

```typescript
import { UpstashApiPlatform } from '@hasna/connect-upstash-api-platform';

const upstash = new UpstashApiPlatform({
  email: process.env.UPSTASH_EMAIL!,
  apiKey: process.env.UPSTASH_API_KEY!,
});

const teams = await upstash.listTeams();
const indices = await upstash.listVectorIndices();
const logs = await upstash.listAuditLogs();
```

## Docs

- Developer API index: https://upstash.com/docs/llms.txt
- Authentication: https://upstash.com/docs/devops/developer-api/authentication
- Teams: https://upstash.com/docs/devops/developer-api/teams/list_teams
- Vector indices: https://upstash.com/docs/devops/developer-api/vector/list_indices
- Audit logs: https://upstash.com/docs/devops/developer-api/account/list_audit_logs

## License

Apache-2.0
