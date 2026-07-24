# @hasna/connect-zolvo

TypeScript connector for the [Zolvo](https://www.ycombinator.com/companies/zolvo) commercial lending servicing API.

## Features

- Bearer token (API key) authentication
- Multi-profile configuration
- Loan listing and retrieval
- Payment listing and reconciliation
- Servicing task creation
- Raw request escape hatch for undocumented endpoints

## Installation

```bash
bun install
bun run build
```

## Configuration

```bash
# Set API key
connect-zolvo config set-key YOUR_API_KEY

# Or use environment variable
export ZOLVO_API_KEY=YOUR_API_KEY

# Optional: override base URL
export ZOLVO_BASE_URL=https://api.zolvo.com/v1
```

Profiles are stored in `~/.hasna/connectors/connect-zolvo/`.

## CLI Usage

```bash
# Loans
connect-zolvo loans list --status active
connect-zolvo loans get "loan-id"

# Payments
connect-zolvo payments list --unmatched
connect-zolvo payments reconcile "payment-id" --confidence 0.92

# Servicing tasks
connect-zolvo tasks create "loan-id" --task "verify invoice"

# Raw API request
connect-zolvo raw-request --path /custom/endpoint --method POST --body '{"enabled":true}'
```

## Library Usage

```typescript
import { Zolvo } from '@hasna/connect-zolvo';

const zolvo = Zolvo.fromEnv();
const loans = await zolvo.listLoans({ status: 'active' });
```

## Development

```bash
bun install
bun run dev loans list
bun run typecheck
bun test
```

## License

Apache-2.0
