# connect-stripe-issuing

Stripe Issuing API connector — card programs, cardholders, cards, authorizations, and transactions.

Uses the official Stripe API at `https://api.stripe.com/v1/issuing/*` with Bearer authentication and form-urlencoded request bodies.

## Installation

```bash
bun install -g @hasna/connect-stripe-issuing
```

## Quick Start

```bash
connect-stripe-issuing config set-key YOUR_STRIPE_SECRET_KEY
export STRIPE_ISSUING_API_KEY=YOUR_STRIPE_SECRET_KEY
connect-stripe-issuing config show
```

## CLI Commands

### Cardholders

```bash
connect-stripe-issuing cardholders list
connect-stripe-issuing cardholders get ich_xxx
connect-stripe-issuing cardholders create --type individual --name "Jane Doe" --billing '{"address":{"line1":"123 Main","city":"SF","state":"CA","postal_code":"94102","country":"US"}}'
```

### Cards

```bash
connect-stripe-issuing cards list --cardholder ich_xxx
connect-stripe-issuing cards get ic_xxx
connect-stripe-issuing cards create --cardholder ich_xxx --currency usd --type virtual
connect-stripe-issuing cards search "metadata['team']:'eng'"
```

### Authorizations & Transactions

```bash
connect-stripe-issuing authorizations list --status pending
connect-stripe-issuing authorizations approve iauth_xxx
connect-stripe-issuing transactions list --card ic_xxx
```

### Events & Raw

```bash
connect-stripe-issuing events list --type issuing_authorization.created
connect-stripe-issuing raw /issuing/disputes -X GET
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_ISSUING_API_KEY` | Stripe secret key (overrides profile) |
| `STRIPE_ISSUING_ACCOUNT_ID` | Account ID for organization keys |
| `STRIPE_ISSUING_BASE_URL` | Override API base URL |
| `STRIPE_ISSUING_API_VERSION` | Pin Stripe-Version header |

## Data Storage

```
~/.hasna/connectors/stripe-issuing/
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
