# connect-thousandeyes

TypeScript connector for the [ThousandEyes REST API](https://developer.thousandeyes.com/). Manage network tests, events, and search path visibility data from the CLI or programmatically.

## Install

```bash
bun install
bun run build
```

## Authentication

Uses a **Bearer token** (API token). Generate one at https://app.thousandeyes.com/settings/users/

```bash
connect-thousandeyes config set-api-key <token>
# or
export THOUSANDEYES_API_KEY=<token>
```

## CLI Usage

```bash
# Profiles & config
connect-thousandeyes profile list
connect-thousandeyes config show
connect-thousandeyes validate

# Tests
connect-thousandeyes tests list
connect-thousandeyes tests get <testId>
connect-thousandeyes tests create --type agent-to-server --body '{"testName":"Example","server":"www.thousandeyes.com",...}'

# Events
connect-thousandeyes events list --start <ms> --end <ms>

# Search & raw requests
connect-thousandeyes search --body '{"query":"..."}'
connect-thousandeyes request --path /tests --method GET
```

## Library

```typescript
import { ThousandEyes } from '@hasna/connect-thousandeyes';

const te = ThousandEyes.fromEnv();
const tests = await te.listTests();
```

## License

Apache-2.0
