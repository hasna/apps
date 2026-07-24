# @hasna/connect-weezevent

TypeScript connector for the [Weezevent Ticketing API](https://api.weezevent.com/).

## Install

```bash
bun install
```

## Configure

```bash
export WEEZEVENT_API_KEY=your-api-key
export WEEZEVENT_ACCESS_TOKEN=your-access-token

# Or via CLI profile
bun run dev config set-key your-api-key
bun run dev config set-access-token your-access-token
```

Obtain an access token interactively:

```bash
bun run dev auth token -u <username> -w <password>
```

## Usage

```bash
bun run dev events list --include-closed
bun run dev dates list -e 11435,10473
bun run dev tickets list -e 11435
bun run dev participants list -e 11122 --full
```

## Library

```typescript
import { WeezeventConnector } from '@hasna/connect-weezevent';

const api = new WeezeventConnector({
  apiKey: process.env.WEEZEVENT_API_KEY!,
  accessToken: process.env.WEEZEVENT_ACCESS_TOKEN!,
});

const events = await api.listEvents({ include_closed: true });
```

## License

Apache-2.0
