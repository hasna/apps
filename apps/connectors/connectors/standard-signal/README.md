# connect-standard-signal

Standard Signal API connector CLI — AI hedge fund portfolios, strategies, positions, trades, and performance with multi-profile support.

## Installation

```bash
bun install -g @hasna/connect-standard-signal
```

## Quick Start

```bash
# Set your API key
connect-standard-signal config set-key YOUR_API_KEY

# Or use environment variable
export STANDARD_SIGNAL_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Portfolios
```bash
connect-standard-signal portfolios list
connect-standard-signal portfolios get <portfolioId>
```

### Strategies
```bash
connect-standard-signal strategies list
```

### Positions
```bash
connect-standard-signal positions list
connect-standard-signal positions list --portfolio-id <id>
```

### Trades
```bash
connect-standard-signal trades list
connect-standard-signal trades list --portfolio-id <id>
```

### Performance
```bash
connect-standard-signal performance get
connect-standard-signal performance get --portfolio-id <id> --from 2024-01-01 --to 2024-12-31
```

### Raw API
```bash
connect-standard-signal raw --path /portfolios
connect-standard-signal raw --path /performance --method GET --query '{"limit":10}'
```

### Profile & Config
```bash
connect-standard-signal profile list
connect-standard-signal profile use <name>
connect-standard-signal profile create <name>
connect-standard-signal config set-key <key>
connect-standard-signal config set-base-url <url>
connect-standard-signal config show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANDARD_SIGNAL_API_KEY` | API key (overrides profile) |
| `STANDARD_SIGNAL_BASE_URL` | API base URL (default: `https://api.standardsignal.com/v1`) |

## Library Usage

```typescript
import { StandardSignal } from '@hasna/connect-standard-signal';

const client = StandardSignal.fromEnv();
const portfolios = await client.portfolios.list();
const performance = await client.performance.get();
```

## License

Apache-2.0
