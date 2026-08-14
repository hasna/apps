# @hasna/connect-userflow

TypeScript connector for the Userflow product onboarding API.

## Install

Ships as part of the `@hasna/connectors` monorepo. From this package directory:

```bash
bun install
bun run build
```

## Authentication

Set your API key from [Userflow settings](https://app.userflow.com/settings/api):

```bash
export USERFLOW_API_KEY=your-api-key
# or
connect-userflow config set-key your-api-key
```

## Examples

```bash
connect-userflow users upsert --id user-1 --attributes '{"plan":"pro"}'
connect-userflow users list --limit 25
connect-userflow flows start --flow-id onboarding --user-id user-1
connect-userflow events track --user-id user-1 --name Activated
connect-userflow webhooks list
```

## Library

```typescript
import { Userflow } from '@hasna/connect-userflow';

const client = Userflow.fromEnv();
await client.users.upsertUser({ id: 'user-1', attributes: { plan: 'pro' } });
```

## License

Apache-2.0
