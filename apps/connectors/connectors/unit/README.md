# connect-unit

TypeScript CLI and library for the [Unit.sh](https://www.unit.co/) Banking-as-a-Service API.

## Features

- JSON:API client with Bearer token authentication
- Sandbox and production environments
- Accounts, applications, customers, cards, transactions, payments, counterparties, webhooks, and events
- Multi-profile configuration at `~/.hasna/connectors/connect-unit/`

## Install

```bash
bun install
bun run build
```

## Authentication

Set your API token from the Unit dashboard:

```bash
connect-unit config set-token <token>
connect-unit config set-environment sandbox
```

Or use environment variables:

```bash
export UNIT_API_TOKEN=your-token
export UNIT_ENVIRONMENT=sandbox
```

## CLI Examples

```bash
connect-unit accounts list
connect-unit accounts get <accountId>
connect-unit customers list --email user@example.com
connect-unit payments list --account-id <accountId>
connect-unit webhooks create --label "My Hook" --url https://example.com/hook --token secret
```

## Library Usage

```typescript
import { Unit } from '@hasna/connect-unit';

const unit = Unit.fromEnv();
const accounts = await unit.accounts.list({ limit: 10 });
```

## License

Apache-2.0
