# @hasna/connect-verdex

TypeScript connector for the [Verdex](https://verdexai.com) API — insurance claims verification, satellite site conditions, portfolio intelligence, and monitoring jobs.

## Install

```bash
bun install
```

## Authentication

Bearer token via environment variable or CLI profile:

```bash
export VERDEX_API_KEY=your-api-key
# optional
export VERDEX_BASE_URL=https://api.verdexai.com/v1

connect-verdex config set-key your-api-key
```

## Usage

```bash
# Claims
bun run dev claims list
bun run dev claims get <claimId>

# Verifications
bun run dev verifications create <claimId> --body '{"type":"satellite"}'
bun run dev verifications get <verificationId>

# Portfolios
bun run dev portfolios list
bun run dev portfolios get <portfolioId>

# Site conditions
bun run dev sites conditions <siteId>

# Monitoring
bun run dev monitoring list
bun run dev monitoring run <jobId>

# Arbitrary request
bun run dev raw-request --path /claims --method GET
```

## Library

```typescript
import { Verdex } from '@hasna/connect-verdex';

const verdex = Verdex.fromEnv();
const claims = await verdex.listClaims();
```

## License

Apache-2.0
