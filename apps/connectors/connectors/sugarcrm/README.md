# @hasna/connect-sugarcrm

TypeScript connector for the [SugarCRM REST API](https://support.sugarcrm.com/Documentation/Sugar_Developer/) (v11_24).

## Features

- OAuth2 password-grant authentication
- Generic module CRUD (Accounts, Contacts, Leads, Opportunities, Cases, and any custom module)
- Search and filter endpoints
- Related record link management
- Metadata and enum option discovery
- Commander-based CLI with profile support

## Installation

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set:

```bash
SUGARCRM_OAUTH_TOKEN=your-oauth-token
SUGARCRM_BASE_URL=https://yourcompany.sugarondemand.com
```

Or use the CLI:

```bash
bun run dev config set-base-url https://yourcompany.sugarondemand.com
bun run dev config set-token your-oauth-token
```

## CLI Usage

```bash
# Authenticate with username/password
bun run dev auth authenticate --username user@example.com --password secret --save

# List accounts
bun run dev record list Accounts --max-num 10

# Get current user
bun run dev user me

# Ping instance
bun run dev ping
```

## SDK Usage

```typescript
import { Connector } from '@hasna/connect-sugarcrm';

const client = new Connector({
  oauthToken: process.env.SUGARCRM_OAUTH_TOKEN!,
  baseUrl: process.env.SUGARCRM_BASE_URL!,
});

const accounts = await client.modules.listAccounts({ maxNum: 10 });
const me = await client.user.getCurrentUser();
```

## License

Apache-2.0
