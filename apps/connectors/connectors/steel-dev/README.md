# connect-steel-dev

TypeScript connector for the [Steel](https://steel.dev) cloud browser API — manage browser sessions, fetch session events, and extract page content.

## Install

```bash
bun install -g @hasna/connect-steel-dev
```

## Setup

```bash
connect-steel-dev config set-key YOUR_STEEL_API_KEY
```

Get your API key from https://app.steel.dev/settings/api-keys

## CLI Usage

### Sessions

```bash
connect-steel-dev sessions list
connect-steel-dev sessions create
connect-steel-dev sessions create --use-proxy --solve-captcha
connect-steel-dev sessions get <sessionId>
connect-steel-dev sessions release <sessionId>
```

### Events

```bash
connect-steel-dev events list <sessionId>
```

### Search / Scrape

```bash
connect-steel-dev search scrape https://example.com --format markdown
```

### Raw API

```bash
connect-steel-dev raw request -X GET -p /sessions
connect-steel-dev raw request -X POST -p /sessions -b options.json
```

### Profiles

```bash
connect-steel-dev profile list
connect-steel-dev profile create work --api-key xxx --use
connect-steel-dev profile use work
```

## Library Usage

```typescript
import { SteelDev } from '@hasna/connect-steel-dev';

const steel = SteelDev.fromEnv();

const session = await steel.sessions.create();
const events = await steel.sessions.events(session.id);
const content = await steel.search.scrape({ url: 'https://example.com', format: ['markdown'] });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STEEL_API_KEY` | Steel API key |
| `STEEL_DEV_BASE_URL` | Optional API base URL override |

## License

Apache-2.0
