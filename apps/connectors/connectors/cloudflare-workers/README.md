# @hasna/connect-cloudflare-workers

Cloudflare Workers REST API connector for scripts, script uploads, settings, routes, deployments, versions, secrets, schedules, tails, subdomains, beta Workers, and scoped raw requests.

## Configure

```bash
cp .env.example .env
export CLOUDFLARE_WORKERS_API_TOKEN=your_cloudflare_api_token
export CLOUDFLARE_WORKERS_ACCOUNT_ID=your_cloudflare_account_id
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are accepted as fallbacks.

## CLI

```bash
bun run ./src/cli/index.ts list-scripts
bun run ./src/cli/index.ts upload-script hello-worker --file ./worker.js --metadata '{"main_module":"worker.js"}'
bun run ./src/cli/index.ts list-routes ZONE_ID
bun run ./src/cli/index.ts create-beta-worker --body '{"name":"hello-worker"}'
bun run ./src/cli/index.ts raw /accounts/ACCOUNT_ID/workers/scripts
```

## Library

```ts
import { CloudflareWorkers } from "@hasna/connect-cloudflare-workers";

const workers = new CloudflareWorkers({
  apiToken: process.env.CLOUDFLARE_WORKERS_API_TOKEN,
  accountId: process.env.CLOUDFLARE_WORKERS_ACCOUNT_ID,
});

const scripts = await workers.listScripts();
await workers.uploadScript("hello-worker", "export default { fetch() { return new Response('ok') } }");
```

## Checks

```bash
bun run test
bun run typecheck
bun run build
```
