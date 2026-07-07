# @hasna/connect-stripeidentity

A TypeScript CLI and library for interacting with the [Stripe Identity](https://stripe.com/docs/identity) API. It provides multi-profile configuration, Bearer token authentication, and a clean CLI built on Commander.js.

Stripe Identity lets you programmatically verify the identity of your users using
government-issued documents, selfies, and ID numbers. This connector wraps the two
public Identity resources: **VerificationSessions** and **VerificationReports**.

## Installation

```bash
bun install
bun run build
```

Or run directly in development:

```bash
bun run dev -- sessions list
```

## Authentication

Stripe Identity uses your standard Stripe secret key (`sk_test_...` / `sk_live_...`).
Provide it via environment variable or a stored profile:

```bash
# Environment variable
export STRIPE_IDENTITY_API_KEY=sk_test_...

# Or store it in the active profile
connect-stripeidentity config set-key sk_test_...
```

Organization API keys (`sk_org_...`) additionally require an account ID:

```bash
connect-stripeidentity config set-account acct_...
```

## Usage

### Profiles & configuration

```bash
connect-stripeidentity profile list
connect-stripeidentity profile create staging --api-key sk_test_... --use
connect-stripeidentity config show
```

### Verification sessions

```bash
# Create a document verification session
connect-stripeidentity sessions create --type document \
  --allowed-types driving_license,passport --require-matching-selfie \
  --return-url "https://example.com/verify/return"

# Create an ID-number verification session
connect-stripeidentity sessions create --type id_number

# Retrieve, list, cancel, and redact
connect-stripeidentity sessions get vs_123
connect-stripeidentity sessions list --status requires_input --limit 20
connect-stripeidentity sessions cancel vs_123
connect-stripeidentity sessions redact vs_123
```

### Verification reports

```bash
connect-stripeidentity reports list --type document
connect-stripeidentity reports get vr_123
```

### Output formats

Use `-f json`, `-f pretty` (default), or `-f table`:

```bash
connect-stripeidentity -f json sessions get vs_123
```

## Library usage

```typescript
import { StripeIdentity } from '@hasna/connect-stripeidentity';

const client = StripeIdentity.fromEnv(); // reads STRIPE_IDENTITY_API_KEY

const session = await client.verificationSessions.create({
  type: 'document',
  options: { document: { require_matching_selfie: true } },
  return_url: 'https://example.com/verify/return',
});

console.log(session.url); // redirect the user here

const report = await client.verificationReports.get('vr_123');
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `STRIPE_IDENTITY_API_KEY` | Stripe secret key (overrides profile) |
| `STRIPE_IDENTITY_ACCOUNT_ID` | Account ID for organization API keys (optional) |
| `STRIPE_IDENTITY_BASE_URL` | Override base URL (optional) |

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
