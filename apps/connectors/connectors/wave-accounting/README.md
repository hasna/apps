# connect-wave-accounting

TypeScript CLI and library for the [Wave Accounting](https://www.waveapps.com/) public GraphQL API.

## Features

- Businesses, customers, invoices, and chart of accounts
- OAuth2 and full-access bearer token authentication
- Multi-profile configuration
- Raw GraphQL query/mutation escape hatch

## API

- **GraphQL endpoint:** `https://gql.waveapps.com/graphql/public`
- **OAuth authorize:** `https://api.waveapps.com/oauth2/authorize/`
- **OAuth token:** `https://api.waveapps.com/oauth2/token/`
- **Docs:** https://developer.waveapps.com

## Install

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set credentials:

```bash
WAVE_ACCESS_TOKEN=your-token
WAVE_BUSINESS_ID=your-business-id
```

Or use the CLI:

```bash
bun run dev config set-token <token>
bun run dev config set-business-id <id>
```

### OAuth2

```bash
bun run dev config set-credentials --client-id <id> --client-secret <secret>
bun run dev auth login
```

## Usage

```bash
# List businesses
bun run dev businesses list

# List invoices (requires business ID)
bun run dev --business-id <id> invoices list

# Create invoice
bun run dev --business-id <id> invoices create --customer-id <id> --product-id <id>

# Raw GraphQL
bun run dev graphql -q 'query { user { id defaultEmail } }'
```

## Build

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
