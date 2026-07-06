# @hasna/connect-zerobounce

TypeScript connector and CLI for the [ZeroBounce](https://www.zerobounce.net/) email validation API.

## Features

- Single and batch real-time email validation
- Sandbox mode for testing without consuming credits
- Bulk file upload and status tracking
- AI email scoring
- Email enrichment (format guessing, domain search, activity data)
- Multi-profile configuration

## Quick Start

```bash
cd connectors/zerobounce
bun install
bun run dev config set-key YOUR_API_KEY
bun run dev validate email user@example.com
bun run dev account credits
```

## Environment

```bash
export ZERO_BOUNCE_API_KEY=your-api-key-here
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-zerobounce';

const zb = new Connector({ apiKey: process.env.ZERO_BOUNCE_API_KEY! });
const result = await zb.validation.validate({ email: 'user@example.com' });
const credits = await zb.account.getCredits();
```

## License

Apache-2.0
