# @hasna/connect-smile-io

Smile.io connector CLI and TypeScript client — loyalty program members, points, rewards, VIP tiers, and referrals via the public [Smile.io REST API](https://dev.smile.io/) (`https://api.smile.io/v1`).

## Install

```bash
bun install
bun run build
```

## Authentication

Create a private API key in your Smile.io admin (Settings → API keys). Requests authenticate with a Bearer token:

```
Authorization: Bearer <SMILEIO_API_KEY>
```

Provide the key via environment variable or the CLI config store:

```bash
export SMILEIO_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

Copy `.env.example` to `.env` and fill in your key for local use. Credentials never leave your machine — the CLI stores them under `~/.hasna/connectors/connect-smile-io/`.

## CLI

```bash
connect-smile-io [--format json|table|pretty] [--profile <name>] <command>
```

### Configuration & profiles

```bash
connect-smile-io config set-key <apiKey>       # store the API key
connect-smile-io config set-base-url <url>     # override the base URL
connect-smile-io config show                   # show current config
connect-smile-io profile list|use|create|delete
```

### Resources

```bash
# Customers
connect-smile-io customers list --state member --limit 50
connect-smile-io customers get 304169228 --include vip_status

# Customer identities (link an external user to a Smile customer)
connect-smile-io identity --email jane@doe.com --distinct-id ext-123

# Points
connect-smile-io points list --customer 304169228
connect-smile-io points get 987654
connect-smile-io points adjust 304169228 100 --description "Welcome bonus"
connect-smile-io points products list --exchange-type fixed
connect-smile-io points products purchase 7 304169228 --points-to-spend 500

# Activities (recorded actions evaluated against earning rules)
connect-smile-io activity activity_token_abc --customer 304169228

# Program configuration
connect-smile-io earning-rules
connect-smile-io vip-tiers --include perks
connect-smile-io settings

# Reward fulfillments
connect-smile-io rewards --customer 304169228 --fulfillment-status issued
```

## Library

```ts
import { Smile } from '@hasna/connect-smile-io';

const smile = Smile.fromEnv(); // reads SMILEIO_API_KEY (and optional SMILEIO_BASE_URL)

const { customers, metadata } = await smile.customers.list({ state: 'member', limit: 50 });
const tx = await smile.pointsTransactions.create({ customer_id: 304169228, points_change: 100 });
const tiers = await smile.vipTiers.list({ include: 'perks' });
```

### Resource groups

| Group | Endpoints |
| --- | --- |
| `customers` | `GET /customers`, `GET /customers/{id}` |
| `customerIdentities` | `POST /customer_identities/create_or_update` |
| `pointsTransactions` | `GET`/`POST /points_transactions`, `GET /points_transactions/{id}` |
| `pointsProducts` | `GET /points_products`, `GET /points_products/{id}`, `POST /points_products/{id}/purchase` |
| `activities` | `POST /activities` |
| `earningRules` | `GET /earning_rules` |
| `vipTiers` | `GET /vip_tiers` |
| `pointsSettings` | `GET /points_settings` |
| `rewardFulfillments` | `GET /reward_fulfillments` |

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
