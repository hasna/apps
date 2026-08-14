# @hasna/connect-zenserp

TypeScript connector for the [Zenserp](https://zenserp.com/) SERP API — real-time Google, Bing, and Yandex search results.

## Install

```bash
bun install
```

## Configure

```bash
export ZENSERP_API_KEY=your-api-key
# or
connect-zenserp config set-key your-api-key
```

## Usage

### CLI

```bash
# Web search
connect-zenserp search query "pied piper" --engine google --num 10

# Image search
connect-zenserp image query "cats"

# Map search
connect-zenserp map query "coffee shop near me"

# Reverse image search
connect-zenserp reverse-image lookup "https://example.com/image.jpg"

# Raw API path
connect-zenserp raw get /search --query "test" --tbm nws
```

### Library

```typescript
import { Zenserp } from '@hasna/connect-zenserp';

const client = new Zenserp({ apiKey: process.env.ZENSERP_API_KEY! });
const results = await client.search.search({ q: 'pied piper', engine: 'google' });
```

## API Reference

- Base URL: `https://app.zenserp.com/api/v2`
- Documentation: https://app.zenserp.com/documentation
- Auth: `apikey` header

## License

Apache-2.0
