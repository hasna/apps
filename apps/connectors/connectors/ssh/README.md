# @hasna/connect-ssh

SSH.com PrivX automation and sessions REST API connector for the Hasna connectors monorepo.

## Install

```bash
bun install
```

## Configuration

```bash
export SSH_API_KEY=your-api-key
# optional:
export SSH_BASE_URL=https://api.ssh.com/v1
```

Or via CLI profile:

```bash
bun run dev config set-key your-api-key
```

## Usage

### CLI

```bash
bun run dev list-sessions
bun run dev create-session --body '{"name":"demo"}'
bun run dev get-session --session-id sess-123
bun run dev list-events
bun run dev search --body '{"query":"active"}'
bun run dev raw-request --path /sessions --method GET
```

### Library

```typescript
import { Ssh } from '@hasna/connect-ssh';

const ssh = Ssh.fromEnv();
const sessions = await ssh.listSessions();
const session = await ssh.getSession('sess-123');
```

## Development

```bash
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
