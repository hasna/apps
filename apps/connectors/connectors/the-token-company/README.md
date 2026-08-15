# connect-the-token-company

The Token Company API connector — LLM prompt compression middleware.

## Installation

```bash
bun install -g @hasna/connect-the-token-company
```

## Quick Start

```bash
# Set your API key
connect-the-token-company config set-api-key YOUR_API_KEY

# Or use environment variable
export THE_TOKEN_COMPANY_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Compress prompt text
connect-the-token-company compress "Your long prompt text..."
connect-the-token-company compress --file prompt.txt --aggressiveness 0.2

# Raw API access
connect-the-token-company raw-request --method POST --path /compress --body '{"input":"..."}'

# Configuration
connect-the-token-company config set-api-key <key>
connect-the-token-company config set-base-url <url>
connect-the-token-company config show
```

## Library Usage

```typescript
import { TheTokenCompany } from '@hasna/connect-the-token-company';

const client = TheTokenCompany.fromEnv();

const result = await client.compress.compress({
  input: 'Your long prompt text...',
  model: 'bear-2',
  compression_settings: { aggressiveness: 0.2 },
});

console.log(result.output);
console.log(result.tokens_saved);
console.log(result.compression_ratio);
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THE_TOKEN_COMPANY_API_KEY` | API key (required) |
| `THE_TOKEN_COMPANY_BASE_URL` | API base URL (default: `https://api.thetokencompany.com/v1`) |

## API Documentation

https://thetokencompany.com/docs

## License

Apache-2.0
