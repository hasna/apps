# VOYGR Connector

TypeScript connector for the [VOYGR](https://dev.voygr.tech) place and business validation API.

## Features

- Account signup and API key recovery (unauthenticated)
- Business/place status validation
- Usage statistics
- Multi-profile configuration
- CLI and programmatic API

## Installation

```bash
bun install
```

## Authentication

VOYGR uses `X-API-Key` header authentication for `/v1/*` endpoints. Signup and recover endpoints are unauthenticated.

| Variable | Description |
|----------|-------------|
| `VOYGR_API_KEY` | API key (overrides profile) |
| `VOYGR_BASE_URL` | API base URL (default: `https://dev.voygr.tech`) |

## CLI Usage

```bash
# Register for an API key
connect-voygr signup --email you@example.com --name "Your Name"

# Recover a lost API key
connect-voygr recover --email you@example.com

# Configure API key
connect-voygr config set-key <your-api-key>

# Check business status
connect-voygr check-business-status --name "Acme Corp" --address "123 Main St"

# Get usage
connect-voygr get-usage
```

## Library Usage

```typescript
import { Voygr } from '@hasna/connect-voygr';

const voygr = new Voygr({ apiKey: process.env.VOYGR_API_KEY });
const status = await voygr.checkBusinessStatus({
  name: 'Acme Corp',
  address: '123 Main St',
});
```

## License

Apache-2.0
