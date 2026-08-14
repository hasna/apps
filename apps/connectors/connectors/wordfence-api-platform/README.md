# Wordfence API Platform Connector

TypeScript connector for the [Wordfence Intelligence v3](https://www.wordfence.com/help/wordfence-intelligence/v3-accessing-and-consuming-the-vulnerability-data-feed/) WordPress vulnerability data feed.

## Authentication

Generate a free API key at [wordfence.com/account/integrations](https://www.wordfence.com/account/integrations). Requests use `Authorization: Bearer <api_key>`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WORDFENCE_API_PLATFORM_API_KEY` | API key (required) |
| `WORDFENCE_API_PLATFORM_BASE_URL` | Optional base URL override (default `https://www.wordfence.com/api/intelligence/v3`) |

## CLI

```bash
bun install
bun run dev config set-key <your-api-key>
bun run dev items list
bun run dev items get <vulnerability-id>
bun run dev events list --since 2024-01-01
bun run dev search -q "contact form" --plugin contact-form-7
bun run dev raw --path /vulnerabilities/production
```

## Library

```typescript
import { WordfenceApiPlatform } from '@hasna/connect-wordfence-api-platform';

const api = WordfenceApiPlatform.fromEnv();
const feed = await api.listVulnerabilities('production');
const match = await api.search({ query: 'xss', pluginSlug: 'elementor', limit: 10 });
```

## Notes

- The production feed is large; prefer `search` or `events list` with date filters when possible.
- Wordfence enforces rate limits (commonly one full-feed request per 30 minutes).
- `createItem` is intentionally unsupported — the public Intelligence feed is read-only.
