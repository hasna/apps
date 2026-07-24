# @hasna/connect-webengage

TypeScript connector and CLI for the [WebEngage](https://webengage.com/) REST API.

## Features

- Track user profiles (`/v1/accounts/{license}/users`)
- Track custom events (`/v1/accounts/{license}/events`)
- Bulk user and event ingestion
- Transactional and multi-campaign delivery (v2 API)
- Multi-profile configuration with data center support

## Installation

```bash
bun add @hasna/connect-webengage
```

## Configuration

Copy `.env.example` and set your credentials from **Data Platform → Integrations → REST API** in the WebEngage dashboard:

```bash
WEBENGAGE_API_KEY=your-api-key
WEBENGAGE_LICENSE_CODE=your-license-code
WEBENGAGE_DC=global
```

Or use the CLI:

```bash
connect-webengage config set-key <api-key>
connect-webengage config set-license <license-code>
connect-webengage config set-dc global
```

## Usage

### CLI

```bash
connect-webengage users track --user-id johndoe --email john@example.com
connect-webengage events track --user-id johndoe --name "Added to Cart"
connect-webengage bulk users --file users.json
connect-webengage transaction send <experiment-id> --user-id johndoe --file txn.json
```

### Library

```typescript
import { Connector } from '@hasna/connect-webengage';

const client = new Connector({
  apiKey: process.env.WEBENGAGE_API_KEY!,
  licenseCode: process.env.WEBENGAGE_LICENSE_CODE!,
  dataCenter: 'global',
});

await client.users.track({ userId: 'johndoe', email: 'john@example.com' });
await client.events.track({ userId: 'johndoe', eventName: 'Purchase' });
```

## License

Apache-2.0
