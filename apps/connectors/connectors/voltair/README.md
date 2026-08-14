# @hasna/connect-voltair

TypeScript connector and CLI for the [Voltair](https://voltair.ai) AI project run API.

## Install

```bash
bun install
```

## Configuration

```bash
export VOLTAIR_API_KEY=your-api-key
# optional
export VOLTAIR_BASE_URL=https://api.voltair.ai/v1

# or via profile
connect-voltair config set-key your-api-key
```

## CLI Usage

```bash
connect-voltair projects list
connect-voltair projects get <projectId>
connect-voltair runs create <projectId> -b '{"prompt":"..."}'
connect-voltair runs get <projectId> <runId>
connect-voltair raw-request --path /custom/endpoint -m POST -b '{}'
```

## Library Usage

```typescript
import { Voltair } from '@hasna/connect-voltair';

const voltair = Voltair.fromEnv();
const projects = await voltair.listProjects({ limit: 5 });
const run = await voltair.createRun('my-project', { prompt: 'optimize route' });
```

## License

Apache-2.0
