# @hasna/connect-zohovault

TypeScript connector for the [Zoho Vault REST API](https://www.zoho.com/vault/help/api/).

## Features

- OAuth2 authentication with Zoho accounts
- Secrets CRUD, password reveal, search
- Chambers, users, groups
- Share/unshare with permissions
- Audit logs, secret types, tags, favorites
- Organization info and password generator
- Multi-profile configuration

## Quick Start

```bash
bun install
bun run dev config set-token <zoho-oauth-token>
bun run dev secrets list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOVAULT_TOKEN` | Zoho OAuth access token |
| `ZOHOVAULT_DATA_CENTER` | Data center (`com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`) |
| `ZOHOVAULT_BASE_URL` | Optional API base URL override |

## License

Apache-2.0
