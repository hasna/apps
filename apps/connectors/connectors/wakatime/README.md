# @hasna/connect-wakatime

TypeScript connector and CLI for the [WakaTime API](https://wakatime.com/developers/api).

## Install

```bash
bun install
```

## Configure

```bash
export WAKATIME_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

Get an API key from https://wakatime.com/api-key.

## Usage

```bash
bun run dev users current
bun run dev stats --range last_7_days
bun run dev summaries --range today
bun run dev projects list
bun run dev meta
```

## Library

```typescript
import { Wakatime } from '@hasna/connect-wakatime';

const wakatime = Wakatime.fromEnv();
const user = await wakatime.users.getCurrentUser();
const stats = await wakatime.stats.get({ range: 'last_7_days' });
```

## License

Apache-2.0
