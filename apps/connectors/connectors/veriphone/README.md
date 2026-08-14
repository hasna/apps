# connect-veriphone

TypeScript CLI and library for the [Veriphone](https://veriphone.io) phone validation and carrier lookup API.

## Features

- Validate phone numbers for 240+ countries
- Detect line type (mobile, fixed-line, VoIP, toll-free)
- Carrier lookup and E.164 formatting
- GET and POST `/v2/verify` support
- Multi-profile configuration

## Installation

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI profile:

```bash
export VERIPHONE_API_KEY=your-api-key-here
# or
bun run dev config set-key your-api-key-here
```

Get an API key at [veriphone.io](https://veriphone.io).

## Usage

```bash
# Validate a phone number (GET)
bun run dev verify "+4915123577723"

# With default country hint
bun run dev verify "015123577723" --default-country DE

# Use POST method
bun run dev verify "+14155552671" --method post

# JSON output
bun run dev verify "+4915123577723" --format json
```

## Library

```typescript
import { Veriphone } from '@hasna/connect-veriphone';

const client = new Veriphone({ apiKey: process.env.VERIPHONE_API_KEY! });
const result = await client.verifyPhone({ phone: '+4915123577723' });
console.log(result.phone_valid, result.carrier);
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
