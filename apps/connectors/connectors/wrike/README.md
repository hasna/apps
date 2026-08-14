# @hasna/connect-wrike

TypeScript connector and CLI for the [Wrike REST API v4](https://developers.wrike.com/).

## Installation

```bash
bun install
```

## Configuration

```bash
connect-wrike config set-token <api-token>
connect-wrike config set-host www.wrike.com
```

Or set environment variables:

- `WRIKE_API_TOKEN` — API access token
- `WRIKE_HOST` — Account host (default `www.wrike.com`)

## Usage

```bash
bun run dev version
bun run dev task list
bun run dev folder list
bun run dev space list
```

## Library

```typescript
import { Wrike } from '@hasna/connect-wrike';

const wrike = new Wrike({ apiToken: process.env.WRIKE_API_TOKEN!, host: 'www.wrike.com' });
const tasks = await wrike.listTasks();
```

## License

Apache-2.0
