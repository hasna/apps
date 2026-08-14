# YouArt Connector

TypeScript connector for the [YouArt](https://youart.ai) creator economy API — projects, AI originals, membership tiers, and funding campaigns.

## Authentication

Bearer token via `YOUART_API_KEY` or profile config (`youart config set-key <key>`).

## Environment

```bash
YOUART_API_KEY=your-api-key-here
# optional
YOUART_BASE_URL=https://api.youart.ai/v1
```

## CLI

```bash
bun install
bun run dev projects list
bun run dev projects get "project 1"
bun run dev originals publish "original 1" --visibility members
bun run dev funding-campaigns create --goal-cents 500000
bun run dev raw-request --path /custom/originals --method POST --body '{"enabled":true}'
```

## Library

```typescript
import { YouArt } from '@hasna/connect-youart';

const youart = YouArt.fromEnv();
const projects = await youart.listProjects({ status: 'launching' });
```

## License

Apache-2.0
