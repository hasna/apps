# @hasna/connect-zymbly

Zymbly REST API connector for aircraft maintenance work orders, parts search, maintenance notes, and scoped raw API calls.

This package was rebuilt from the public Zymbly API contract and open-connectors patterns. It is not a copy of internal platform code.

## Configure

```bash
export ZYMBLY_API_KEY=REPLACE_ME
export ZYMBLY_BASE_URL=https://api.zymbly.com/v1
```

## CLI

```bash
bun run ./src/cli/index.ts work-orders list --query '{"status":"open","limit":25}'
bun run ./src/cli/index.ts work-orders get WO-123
bun run ./src/cli/index.ts parts search --query '{"q":"brake pad"}'
bun run ./src/cli/index.ts notes create WO-123 --note "Completed 100-hour inspection"
bun run ./src/cli/index.ts raw GET /aircraft/N12345/inspections
```

## Programmatic Usage

```ts
import { ZymblyClient } from "@hasna/connect-zymbly";

const client = new ZymblyClient({ apiKey: process.env.ZYMBLY_API_KEY });
await client.listWorkOrders({ status: "open" });
```

## Security

Do not commit real Zymbly API keys. Use placeholder values in `.env.example` only.
