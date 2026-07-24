# @hasna/connect-textsidekick

TypeScript connector for the [Sidekick](https://www.textsidekick.com/) (Textsidekick) SMS frontline assistant API.

## Features

- Bearer token authentication (`TEXTSIDEKICK_API_KEY`)
- Optional custom base URL (`TEXTSIDEKICK_BASE_URL`)
- Documents, workers, messages, escalations, tutorials, and phone-number endpoints
- CLI and programmatic library API
- Multi-profile configuration

## Quick Start

```bash
cd connectors/textsidekick
bun install
export TEXTSIDEKICK_API_KEY=your-api-key
bun run dev documents list
```

## CLI

```bash
textsidekick documents list
textsidekick documents get <documentId>
textsidekick documents upload --data '{"name":"SOP.pdf"}'
textsidekick workers list
textsidekick messages send --data '{"workerId":"w1","body":"What is the SOP?"}'
textsidekick escalations list
textsidekick escalations resolve <escalationId>
textsidekick tutorials list
textsidekick phone-number
textsidekick raw --path /documents --method GET
```

## Library

```typescript
import { Sidekick } from '@hasna/connect-textsidekick';

const sidekick = Sidekick.fromEnv();
const documents = await sidekick.listDocuments();
await sidekick.sendMessage({ workerId: 'w1', body: 'Hello' });
```

## Authentication

Set `TEXTSIDEKICK_API_KEY` or use `textsidekick config set-key <key>`. Profiles are stored under `~/.hasna/connectors/textsidekick/`.

## API Base URL

Default: `https://api.textsidekick.com/v1`

Override with `TEXTSIDEKICK_BASE_URL` or `textsidekick config set-base-url <url>`.

## Development

```bash
bun run dev
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
