# connect-testim

Testim API connector — AI test automation with multi-profile support.

## Installation

```bash
bun install -g @hasna/connect-testim
```

## Quick Start

```bash
# Set your API key
testim config set-key YOUR_API_KEY

# Or use environment variable
export TESTIM_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
testim config set-key <key>       # Set API key
testim config show                # Show config
testim profile list               # List profiles
testim tests list                 # List tests on master branch
testim tests get <testId>         # Get test details
testim tests search <name>        # Search tests by name
testim tests search-suites <name> # Search suites by name
testim tests search-plans <name>  # Search test plans by name
testim tests run <testId> --grid <grid> # Execute test remotely
testim tests raw -m GET -p /tests # Raw API request
```

## Library Usage

```typescript
import { Testim } from '@hasna/connect-testim';

const client = new Testim({ apiKey: 'YOUR_API_KEY' });
const tests = await client.tests.list({ branch: 'master' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TESTIM_API_KEY` | API key (overrides profile) |
| `TESTIM_BASE_URL` | Override base URL (e.g. `https://api.eu.testim.io`) |

## Development

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
