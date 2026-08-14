# Stripe Sigma Connector

TypeScript connector for [Stripe Sigma](https://stripe.com/sigma) SQL analytics via the official Query Runs API.

## Features

- Create Sigma query runs with raw SQL or saved query IDs
- Retrieve query run status and result file references
- Multi-profile configuration (`~/.hasna/connectors/stripe-sigma/`)
- Bearer authentication using your Stripe secret key (`sk_test_*` / `sk_live_*`)

## Requirements

- [Bun](https://bun.sh) >= 1.0
- Stripe account with **Sigma enabled**
- Stripe secret API key from the [Dashboard](https://dashboard.stripe.com/apikeys)

## Installation

```bash
bun install
bun run build
```

## Configuration

```bash
# Set API key for the active profile
stripe-sigma config set-key sk_test_...

# Or use environment variables
export STRIPE_SIGMA_API_KEY=sk_test_...
```

Profiles are stored in `~/.hasna/connectors/stripe-sigma/profiles/`.

Sigma query runs require a **preview** Stripe API version (default: `2025-06-30.preview`). Override with:

```bash
stripe-sigma config set-api-version 2025-06-30.preview
# or STRIPE_SIGMA_API_VERSION
```

## CLI Usage

```bash
# Create a query run
stripe-sigma query-runs create --sql "SELECT * FROM balance_transactions LIMIT 10"

# Run a saved Sigma query
stripe-sigma query-runs create --from-saved-query sq_xxx

# Check status / results
stripe-sigma query-runs get qry_xxx

# Profile management
stripe-sigma profile list
stripe-sigma profile create prod --api-key sk_live_... --use
```

## API Reference

- [Create Query Run](https://docs.stripe.com/api/sigma/query_runs/create) — `POST /v1/sigma/query_runs`
- [Retrieve Query Run](https://docs.stripe.com/api/sigma/query_runs/retrieve) — `GET /v1/sigma/query_runs/:id`

## Library Usage

```typescript
import { Connector } from '@hasna/connect-stripe-sigma';

const sigma = Connector.fromEnv();
const run = await sigma.queryRuns.create({
  sql: 'SELECT count(*) FROM charges',
});
const status = await sigma.queryRuns.get(run.id);
```

## License

Apache-2.0
