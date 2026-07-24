# @hasna/connect-wappalyzer

TypeScript CLI and library for the [Wappalyzer API v2](https://www.wappalyzer.com/docs/api/v2/) — website technology lookup and enrichment.

## Install

```bash
bun install
bun run build
```

## Authentication

Create an API key in your Wappalyzer account and configure it via environment variable or CLI profile:

```bash
export WAPPALYZER_API_KEY=your-api-key
# or
connect-wappalyzer config set-key your-api-key
```

## CLI

```bash
# Technology lookup (1–10 URLs)
connect-wappalyzer lookup https://example.com
connect-wappalyzer lookup https://a.com https://b.com --live --sets company,contact

# Credit balance
connect-wappalyzer credits balance

# Profiles
connect-wappalyzer profile list
connect-wappalyzer profile create staging --api-key <key> --use
```

## Library

```typescript
import { Connector } from '@hasna/connect-wappalyzer';

const client = Connector.fromEnv();
const results = await client.lookup.lookup({ urls: ['https://example.com'] });
const balance = await client.credits.balance();
```

## API

- Base URL: `https://api.wappalyzer.com/v2`
- Auth: `x-api-key` header
- Docs: https://www.wappalyzer.com/docs/api/v2/

## License

Apache-2.0
