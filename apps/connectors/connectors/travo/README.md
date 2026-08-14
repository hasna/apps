# connect-travo

Travo real-estate intelligence API connector — property search, comps, ownership, zoning, financials, and enrichment.

## Installation

```bash
bun install -g @hasna/connect-travo
```

## Quick Start

```bash
# Set your API key
connect-travo config set-key YOUR_API_KEY

# Or use environment variable
export TRAVO_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-travo config set-key <api-key>
connect-travo config show

connect-travo properties search --asset-type rv_park --state TX
connect-travo properties get <propertyId>
connect-travo properties comps <propertyId> --radius 25
connect-travo properties ownership <propertyId>
connect-travo properties zoning <propertyId>
connect-travo properties financials <propertyId>
connect-travo properties enrich <propertyId> --sources web,phone

connect-travo raw-request --path /properties/search --query '{"q":"retail"}'
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-travo';

const travo = new Connector({ apiKey: process.env.TRAVO_API_KEY! });
const results = await travo.properties.searchProperties({ state: 'TX' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRAVO_API_KEY` | API key |
| `TRAVO_BASE_URL` | Optional base URL (default: `https://api.travoai.com/v1`) |

## License

Apache-2.0
