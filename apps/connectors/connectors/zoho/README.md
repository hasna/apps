# @hasna/connect-zoho

Zoho CRM v8 API connector for contacts, leads, accounts, and deals.

## Authentication

Uses OAuth access tokens via the `Zoho-oauthtoken` header. Obtain a token from the [Zoho OAuth flow](https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html).

```bash
export ZOHO_ACCESS_TOKEN=your-oauth-access-token
```

## CLI

```bash
bun install
bun run dev list-contacts
bun run dev get-contact <id>
bun run dev add-contacts --last-name "Doe" --first-name "Jane" --email "jane@example.com"
bun run dev list-leads
bun run dev list-accounts
bun run dev list-deals
bun run dev raw-request --path /settings/modules
```

## Library

```typescript
import { Zoho } from '@hasna/connect-zoho';

const zoho = Zoho.fromEnv();
const contacts = await zoho.listContacts({ per_page: 10 });
```

## API

- Base URL: `https://www.zohoapis.com/crm/v8` (override with `ZOHO_BASE_URL`)
- Docs: https://www.zoho.com/crm/developer/docs/api/v8/

## License

Apache-2.0
