# @hasna/connect-unleash

TypeScript connector for the [Unleash](https://www.getunleash.io/) feature flag Admin API.

## Install

```bash
bun add @hasna/connect-unleash
```

## Configuration

Copy `.env.example` and set your instance credentials:

```bash
UNLEASH_API_KEY=your-api-token
UNLEASH_BASE_URL=https://your-instance.app.unleash-hosted.com/your-instance/api
UNLEASH_PROJECT=default
```

## CLI

```bash
connect-unleash flags list
connect-unleash flags get my-feature
connect-unleash flags create --name my-feature
connect-unleash events list
connect-unleash request raw -m GET -p /admin/events
```

## Library

```typescript
import { Connector } from '@hasna/connect-unleash';

const unleash = Connector.fromEnv();
const flags = await unleash.flags.list();
```

## License

Apache-2.0
