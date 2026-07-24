# @hasna/connect-ynab

TypeScript connector and CLI for the [YNAB API](https://api.ynab.com) (You Need A Budget).

## Authentication

YNAB uses a **Personal Access Token** sent as a Bearer token. Create a token at [YNAB Developer Settings](https://app.ynab.com/settings/developer).

```bash
export YNAB_ACCESS_TOKEN=your-token-here
# or
connect-ynab config set-token your-token-here
```

## Quick start

```bash
bun install
bun run dev plan list
bun run dev user get
```

## Amounts

YNAB represents currency amounts in **milliunits** (1/1000 of the currency unit). For example, $12.34 is stored as `12340`.

## Plan IDs

The API accepts `plan_id` values including `last-used` and `default` in addition to UUID plan IDs. See [YNAB API docs](https://api.ynab.com).

## Commands

| Command | Description |
|---------|-------------|
| `user get` | Authenticated user info |
| `plan list` | List plans |
| `plan get <plan_id>` | Get plan details |
| `plan settings <plan_id>` | Plan settings |
| `account list <plan_id>` | List accounts |
| `category list <plan_id>` | List categories |
| `transaction list <plan_id>` | List transactions |
| `transaction create <plan_id>` | Create a transaction |
| `month list <plan_id>` | List budget months |
| `payee list <plan_id>` | List payees |
| `scheduled list <plan_id>` | List scheduled transactions |

## Library usage

```typescript
import { Ynab } from '@hasna/connect-ynab';

const ynab = Ynab.fromEnv();
const plans = await ynab.listPlans();
```

## License

Apache-2.0
