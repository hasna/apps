# @hasna/connect-talkdesk

A TypeScript CLI and library for the [Talkdesk](https://www.talkdesk.com/) cloud
contact center (CCaaS) API. Rebuilt from the public
[Talkdesk API documentation](https://docs.talkdesk.com).

## Features

- OAuth 2.0 **client credentials** authentication with automatic token caching
  and refresh (or bring your own bearer token).
- Typed API client for **Users**, **Contacts**, and the **Explore** reporting API.
- Multi-profile configuration stored under `~/.hasna/connectors/connect-talkdesk/`.
- Commander-based CLI with `json`, `table`, and `pretty` output formats.

## Install

```bash
bun install
bun run build
```

## Authentication

Create an OAuth client with the **Client Credentials** grant in Talkdesk
(Admin → Integrations → OAuth Clients) and configure the CLI:

```bash
connect-talkdesk config set-client-id <client-id>
connect-talkdesk config set-client-secret <client-secret>
connect-talkdesk config set-auth-url https://your-account.talkdeskid.com/oauth/token
```

Or use environment variables:

```bash
export TALKDESK_CLIENT_ID=your-client-id
export TALKDESK_CLIENT_SECRET=your-client-secret
export TALKDESK_AUTH_URL=https://your-account.talkdeskid.com/oauth/token
# Optional overrides:
# export TALKDESK_BASE_URL=https://api.talkdeskapp.com
# export TALKDESK_ACCESS_TOKEN=pre-obtained-bearer-token
```

The client exchanges the credentials for a bearer token at
`TALKDESK_AUTH_URL` using the `client_credentials` grant. Talkdesk identity
endpoints are account-specific: US/default accounts use
`https://<talkdesk-account-name>.talkdeskid.com/oauth/token`; EU, CA, and AU
accounts use `talkdeskid.eu`, `talkdeskidca.com`, and `talkdeskid.au`
respectively. See
[Client Credentials - Basic](https://docs.talkdesk.com/reference/cc-basic).

## CLI usage

```bash
# Users
connect-talkdesk users list --per-page 50
connect-talkdesk users get <user-id>
connect-talkdesk users me

# Contacts
connect-talkdesk contacts list
connect-talkdesk contacts get <contact-id>
connect-talkdesk contacts create "Ada Lovelace" --email ada@example.com
connect-talkdesk contacts delete <contact-id>

# Explore reporting (asynchronous jobs)
connect-talkdesk reports calls-create --start 2026-01-01T00:00:00.000Z --end 2026-01-31T23:59:59.999Z --report-format json
connect-talkdesk reports calls-status <job-id>

# Output format & profiles
connect-talkdesk --format json users list
connect-talkdesk profile create staging
connect-talkdesk --profile staging config set-client-id <id>
```

## Library usage

```typescript
import { Talkdesk } from '@hasna/connect-talkdesk';

const talkdesk = Talkdesk.fromEnv(); // reads TALKDESK_CLIENT_ID / TALKDESK_CLIENT_SECRET / TALKDESK_AUTH_URL

const users = await talkdesk.users.list({ perPage: 50 });
const contact = await talkdesk.contacts.create({ name: 'Ada Lovelace' });
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## API references

- [Authentication](https://docs.talkdesk.com/docs/authentication)
- [Users API](https://docs.talkdesk.com/docs/usersapi)
- [Contacts API](https://docs.talkdesk.com/docs/contacts-api)
- [Explore API](https://docs.talkdesk.com/docs/explore-api)

## License

Apache-2.0
