# connect-testrigor

TypeScript connector and CLI for the [TestRigor](https://testrigor.com) automated testing platform.

## Install

```bash
bun install
```

## Configuration

```bash
export TESTRIGOR_API_KEY=your-api-key-here
# or
connect-testrigor config set-key your-api-key-here
```

## Usage

```bash
# List test suites
connect-testrigor suites list

# Get a suite
connect-testrigor suites get <suite-id>

# Create a suite
connect-testrigor suites create --body '{"name":"Smoke tests"}'

# List events
connect-testrigor events list

# Search
connect-testrigor search --body '{"query":"checkout"}'

# Raw API request
connect-testrigor request --method GET --path /suites
```

## Library

```typescript
import { TestRigor } from '@hasna/connect-testrigor';

const api = TestRigor.fromEnv();
const suites = await api.listSuites();
```

## License

Apache-2.0
