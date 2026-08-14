# Wato Connector

TypeScript API connector for [Wato](https://watolabs.com) — shared agent memories, workflows, tools, and artifacts.

## Authentication

Bearer token via `WATO_API_KEY` or profile config (`wato config set-key <key>`).

## Quick Start

```bash
cd connectors/wato
bun install
export WATO_API_KEY=your-api-key

bun run dev memories list --query '{"scope":"team"}'
bun run dev memories upsert --title "pricing policy" --content "approved by finance"
bun run dev workflows run "wf 1" --input '{"account":"acme"}'
bun run dev tools list --query '{"connected":true}'
bun run dev artifacts get "artifact 1"
```

## Library Usage

```typescript
import { Wato } from '@hasna/connect-wato';

const wato = Wato.fromEnv();
const memories = await wato.listMemories({ scope: 'team' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WATO_API_KEY` | API key (Bearer token) |
| `WATO_BASE_URL` | Optional API base URL (default `https://api.watolabs.com/v1`) |

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
