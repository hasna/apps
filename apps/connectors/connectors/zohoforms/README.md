# @hasna/connect-zohoforms

TypeScript connector for the [Zoho Forms API v2](https://www.zoho.com/forms/help/api/).

## Features

- Forms, fields, reports, and entries (CRUD + bulk delete)
- Workspaces, themes, webhooks, approval tasks
- Payments, settings, and form sharing
- Multi-profile CLI with `connect-zohoforms`
- Data center support (com, eu, in, com.au, jp, ca, sa)

## Authentication

Zoho Forms uses OAuth 2.0 access tokens with the `Zoho-oauthtoken` header. Obtain a token via the [Zoho OAuth flow](https://www.zoho.com/forms/help/api/) and configure it via environment variable or CLI profile.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHOFORMS_TOKEN` | OAuth access token |
| `ZOHOFORMS_DATA_CENTER` | Data center (`com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`) |
| `ZOHOFORMS_BASE_URL` | Optional API base URL override |

## CLI

```bash
bun install
bun run dev config set-token <token>
bun run dev forms list
bun run dev entries list <formLinkName>
bun run dev webhooks list <formLinkName>
bun run dev tasks list
```

## Library

```typescript
import { ZohoForms } from '@hasna/connect-zohoforms';

const forms = ZohoForms.fromEnv();
const { forms: list } = await forms.listForms();
```

## License

Apache-2.0
