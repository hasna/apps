# @hasna/connect-ticketmaster

TypeScript connector for the [Ticketmaster Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).

## Features

- Search and retrieve **events**, **attractions**, and **venues**
- API key authentication via `apikey` query parameter
- Multi-profile configuration
- CLI and library exports

## Quick Start

```bash
bun install
export TICKETMASTER_API_KEY=your-consumer-key
bun run dev events search --countryCode US --keyword concert
```

## CLI

```bash
connect-ticketmaster events search --countryCode US
connect-ticketmaster events get <eventId>
connect-ticketmaster attractions search --keyword artist
connect-ticketmaster attractions get <attractionId>
connect-ticketmaster venues search --city "Los Angeles"
connect-ticketmaster venues get <venueId>
connect-ticketmaster config set-key <key>
```

## Library

```typescript
import { Connector } from '@hasna/connect-ticketmaster';

const tm = new Connector({ apiKey: process.env.TICKETMASTER_API_KEY! });
const events = await tm.events.search({ countryCode: 'US', keyword: 'concert' });
```

## License

Apache-2.0
