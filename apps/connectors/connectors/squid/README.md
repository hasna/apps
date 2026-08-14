# connect-squid

TypeScript connector for the [Squid.energy](https://squid.energy) grid planning workspace API.

## Install

```bash
bun install
```

## Configure

```bash
export SQUID_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

## Usage

```bash
bun run dev network-models list
bun run dev assets list
bun run dev workflows list
bun run dev workflow-runs create --workflow-id wf_123
```

## Library

```typescript
import { Connector } from '@hasna/connect-squid';

const squid = Connector.fromEnv();
const models = await squid.listNetworkModels();
```

## License

Apache-2.0
