# connect-tipalti

Tipalti connector CLI — global payments platform for payees, events, and accounts payable automation.

## Installation

```bash
bun install -g @hasna/connect-tipalti
```

## Quick Start

```bash
export TIPALTI_API_KEY=your-api-key
connect-tipalti payee list
```

Or configure a profile:

```bash
connect-tipalti config set-key your-api-key
connect-tipalti payee list --format json
```

## CLI Commands

### Configuration

```bash
connect-tipalti config set-key <key>
connect-tipalti config set-url <baseUrl>
connect-tipalti config show
connect-tipalti config clear
```

### Profiles

```bash
connect-tipalti profile list
connect-tipalti profile create work --api-key <key> --use
connect-tipalti profile use work
```

### Payees

```bash
connect-tipalti payee list
connect-tipalti payee get <payeeId>
connect-tipalti payee create --email payee@example.com --ref-code REF001
```

### Events & Search

```bash
connect-tipalti events list
connect-tipalti search run --query acme --entity-type payee
```

### Raw API

```bash
connect-tipalti raw request --path /payees --method GET
connect-tipalti raw request --path /search --method POST --body '{"query":"acme"}'
```

## Library Usage

```typescript
import { Tipalti } from '@hasna/connect-tipalti';

const tipalti = Tipalti.fromEnv();
const payees = await tipalti.listPayees();
```

## Documentation

- [Tipalti API docs](https://documentation.tipalti.com)

## License

Apache-2.0
