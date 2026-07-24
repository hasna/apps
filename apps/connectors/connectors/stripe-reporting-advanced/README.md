# @hasna/connect-stripe-reporting-advanced

A TypeScript CLI and library for generating scheduled financial reports with the
[Stripe Reporting API](https://docs.stripe.com/api/reporting). It provides
multi-profile configuration, Bearer token authentication, and a clean CLI built
with Commander.js.

The Reporting API lets you programmatically generate the same financial reports
available in the Stripe Dashboard — balance changes, payouts reconciliation,
itemized fees, and more — as downloadable CSV files.

## Install

```bash
bun install
```

## Authentication

You need a Stripe **secret** API key (`sk_live_...` or `sk_test_...`). Report
_types_ (schemas) are only listable/retrievable with a live-mode key, while
report _runs_ can be created in either mode.

Set the key via environment variable or a saved profile:

```bash
export STRIPE_API_KEY=sk_live_...
# or
connect-stripe-reporting-advanced config set-key sk_live_...
```

## CLI Usage

```bash
# Discover available report types
connect-stripe-reporting-advanced report-types list
connect-stripe-reporting-advanced report-types get balance.summary.1

# Kick off a report run for an interval
connect-stripe-reporting-advanced report-runs create \
  --report-type balance.summary.1 \
  --interval-start 2024-01-01 \
  --interval-end 2024-02-01

# Restrict columns / currency / timezone
connect-stripe-reporting-advanced report-runs create \
  --report-type balance_change_from_activity.itemized.3 \
  --interval-start 1704067200 --interval-end 1706745600 \
  --columns balance_transaction_id,net,fee --currency usd \
  --timezone America/Los_Angeles

# Poll a run until its `result` file is populated
connect-stripe-reporting-advanced report-runs get frr_...

# List recent runs
connect-stripe-reporting-advanced report-runs list --limit 20
```

`--interval-start` / `--interval-end` / `--created` accept either a Unix
timestamp or an ISO date string. Global flags: `--format json|pretty`,
`--profile <name>`, `--api-key <key>`.

## Library Usage

```typescript
import { Connector } from '@hasna/connect-stripe-reporting-advanced';

const stripe = Connector.fromEnv(); // reads STRIPE_API_KEY

const types = await stripe.reportTypes.list();

const run = await stripe.reportRuns.create({
  report_type: 'balance.summary.1',
  parameters: {
    interval_start: 1704067200,
    interval_end: 1706745600,
  },
});

// Poll until run.status === 'succeeded', then download run.result.url
const latest = await stripe.reportRuns.get(run.id);
```

## Scripts

```bash
bun run dev         # run the CLI from source
bun run build       # build library (dist/) and CLI (bin/)
bun run typecheck   # tsc --noEmit
bun test            # run unit tests
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_API_KEY` | Stripe secret API key (required) |
| `STRIPE_BASE_URL` | Override base URL (defaults to `https://api.stripe.com/v1`) |
| `STRIPE_API_VERSION` | Pin a specific Stripe API version |

## License

Apache-2.0
