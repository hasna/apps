# connect-trustpilot-business

TypeScript CLI and library for the [Trustpilot Business API](https://developers.trustpilot.com).

## Features

- Service review listing and retrieval (public and private endpoints)
- Email invitations and invitation links
- Business unit search and lookup
- Webhook subscription listing
- Multi-profile configuration
- Raw request escape hatch

## Quick Start

```bash
bun install
export TRUSTPILOT_BUSINESS_API_KEY=your-api-key
bun run dev search find example.com
```

## Authentication

Public endpoints use your Trustpilot API key in the `apikey` header. Private Business endpoints require an API secret for client credentials token exchange.

## CLI Examples

```bash
# Search for a business unit
connect-trustpilot-business search business-units "trustpilot.com"

# List public reviews
connect-trustpilot-business reviews list <businessUnitId>

# List private reviews (requires API secret)
connect-trustpilot-business reviews list <businessUnitId> --private

# Get a review
connect-trustpilot-business reviews get <reviewId>

# Create email invitation
connect-trustpilot-business reviews create-invitation <businessUnitId> \
  --consumer-email customer@example.com \
  --consumer-name "Jane Doe"

# List webhook subscriptions
connect-trustpilot-business events list
```

## License

Apache-2.0
