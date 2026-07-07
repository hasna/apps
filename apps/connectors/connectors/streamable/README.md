# @hasna/connect-streamable

TypeScript connector for the documented [Streamable](https://streamable.com) read-only video API.

## Features

- Video metadata lookup by shortcode
- oEmbed retrieval by Streamable URL
- No credentials required for the documented read-only API

## Quick Start

```bash
cd connectors/streamable
bun install
bun run dev video hn8hq
bun run dev oembed https://streamable.com/hn8hq
```

## CLI

```bash
bun run dev video <shortcode>
bun run dev oembed <streamable-url>
```

## Library

```typescript
import { Streamable } from '@hasna/connect-streamable';

const streamable = new Streamable();
const video = await streamable.getVideo('hn8hq');
const embed = await streamable.getOEmbed('https://streamable.com/hn8hq');
```

## API Reference

- [Streamable API documentation](https://streamable-support.zendesk.com/hc/en-us/articles/35415672400916-API-Documentation)
- Base URL: `https://api.streamable.com`
- Auth: not required for the documented read-only endpoints
- Supported endpoints: `GET /videos/{shortcode}`, `GET /oembed.json?url=...`

## License

Apache-2.0
