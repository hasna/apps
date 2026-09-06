# @hasna/economy-sdk

TypeScript client for the `@hasna/economy` REST API.

## Install

```bash
bun add @hasna/economy-sdk
```

## Usage

```ts
import { EconomyClient } from '@hasna/economy-sdk'

const economy = new EconomyClient({ baseUrl: 'http://127.0.0.1:3456' })
const summary = await economy.getSummary('today')
```

For an authenticated self-hosted service, pass `apiKey`; the client sends it as `x-api-key`:

```ts
const economy = new EconomyClient({
  baseUrl: 'https://economy.example.com',
  apiKey: process.env.HASNA_ECONOMY_API_KEY,
})
```

An explicit `baseUrl` with no `apiKey` sends NO key at all — the SDK never attaches the ambient fleet credential (hasna/apps#1794).

`EconomyClient.fromEnv()` reads `HASNA_ECONOMY_API_URL` (legacy fallbacks `ECONOMY_API_URL`, then `ECONOMY_URL`) and `HASNA_ECONOMY_API_KEY` (legacy fallback `ECONOMY_API_KEY`). Client methods use the canonical `/v1` API and unwrap its `{ data, meta }` response envelope. See the repository [REST reference](../docs/rest-api.md) for routes and server authentication.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

## License

Apache-2.0. See [LICENSE](LICENSE).
