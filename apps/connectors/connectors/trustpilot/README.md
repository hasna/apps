# @hasna/connect-trustpilot

TypeScript connector for the [Trustpilot Business API](https://developers.trustpilot.com/).

## Install

```bash
bun install
```

## Configuration

```bash
connect-trustpilot config set-key <api-key>
connect-trustpilot config set-token <oauth-access-token>
```

Or use environment variables:

```bash
export TRUSTPILOT_API_KEY=your_api_key
export TRUSTPILOT_ACCESS_TOKEN=your_access_token
```

## Usage

```bash
# List categories (public, API key)
connect-trustpilot categories list --country US

# Find a business unit
connect-trustpilot business-units find --name "Example Corp"

# List private reviews (OAuth bearer)
connect-trustpilot reviews list-private <businessUnitId>

# Send invitation email
connect-trustpilot invitations send-email <businessUnitId> --email user@example.com

# Generate OAuth authorization URL
connect-trustpilot oauth auth-link --redirect-uri https://example.com/callback
```

## Library

```typescript
import { Connector } from '@hasna/connect-trustpilot';

const tp = new Connector({
  apiKey: process.env.TRUSTPILOT_API_KEY,
  accessToken: process.env.TRUSTPILOT_ACCESS_TOKEN,
});

const categories = await tp.categories.list({ country: 'US' });
const reviews = await tp.reviews.listPrivate({ businessUnitId: 'bu-id' });
```

## License

Apache-2.0
