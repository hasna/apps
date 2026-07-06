# connect-typeform

TypeScript connector for the [Typeform API](https://www.typeform.com/developers/) with Bearer personal access token authentication and multi-profile CLI support.

## Authentication

Uses a **Personal Access Token** (Bearer). Create one at [Typeform account tokens](https://admin.typeform.com/user/tokens).

```bash
export TYPEFORM_API_TOKEN=your-token
# or
connect-typeform config set-token your-token
```

## Install

```bash
bun install
```

## CLI

```bash
bun run dev forms list
bun run dev responses list <formId>
bun run dev responses delete <formId> --response-ids <response_id,response_id>
bun run dev webhooks list <formId>
bun run dev workspaces list
bun run dev themes list
bun run dev images list
bun run dev raw-request --path /forms
```

### Profile management

```bash
connect-typeform profile list
connect-typeform profile create work --api-token <token> --use
connect-typeform config show
```

## Library

```typescript
import { Typeform } from '@hasna/connect-typeform';

const typeform = Typeform.fromEnv();
const forms = await typeform.listForms({ pageSize: 10 });
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
