# @hasna/connect-zoom-api

Zoom Api REST connector for items, events, search, and guarded raw API access.

## Configure

```bash
export ZOOM_API_API_KEY=REPLACE_ME
```

Optional:

```bash
export ZOOM_API_BASE_URL=https://api.zoomapi.com/v1
```

You can also store local configuration:

```bash
bun run ./src/cli/index.ts config set-api-key REPLACE_ME
```

## CLI

```bash
bun run ./src/cli/index.ts items list
bun run ./src/cli/index.ts items get item-1
bun run ./src/cli/index.ts items create --body '{"name":"widget"}'
bun run ./src/cli/index.ts events list
bun run ./src/cli/index.ts search --body '{"query":"zoom"}'
bun run ./src/cli/index.ts request --method GET --path /items
```

## Programmatic Usage

```ts
import { ZoomApiClient } from "@hasna/connect-zoom-api";

const client = new ZoomApiClient({
  apiKey: process.env.ZOOM_API_API_KEY,
});

const items = await client.listItems();
const item = await client.getItem("item-1");
```
