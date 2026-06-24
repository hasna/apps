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
const summary = await economy.summary({ period: 'today' })
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

## License

Apache-2.0. See [LICENSE](LICENSE).
