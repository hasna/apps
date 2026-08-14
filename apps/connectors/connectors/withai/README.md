# @hasna/connect-withai

TypeScript connector for the [WithAI](https://withai.co) API — asset-manager command center for workspaces, research tasks, document search, portfolio alerts, and integrations.

## Install

```bash
bun install
```

## Configuration

```bash
export WITHAI_API_KEY=your-api-key
# optional
export WITHAI_BASE_URL=https://api.withai.co/v1
```

Or use profiles:

```bash
bun run dev config set-key your-api-key
```

## Usage

### CLI

```bash
bun run dev workspaces list
bun run dev workspaces get ws-123
bun run dev research-tasks create ws-123 --ticker MSFT --prompt "update model"
bun run dev research-tasks get task-456
bun run dev documents search --search-text "earnings" --filters '{"ticker":"MSFT"}'
bun run dev portfolio alerts create --ticker MSFT --threshold "guidance change"
bun run dev integrations list
```

### Library

```typescript
import { WithAi } from '@hasna/connect-withai';

const api = WithAi.fromEnv();
const workspaces = await api.listWorkspaces({ firm: 'alpha' });
```

## License

Apache-2.0
