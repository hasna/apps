# @hasna/connect-wayco

TypeScript connector and CLI for the [Wayco](https://wayco.ai/) med-legal AI API.

## Features

- Bearer token authentication
- Med-legal case and lead workflows
- Medical record summarization and provider matching
- Voice call retrieval
- Raw API escape hatch
- Multi-profile CLI configuration

## Install

```bash
bun install
```

## Configuration

```bash
export WAYCO_API_KEY=your-api-key
# optional
export WAYCO_BASE_URL=https://api.wayco.ai/v1
```

Or use CLI profiles:

```bash
bun run dev config set-key your-api-key
bun run dev config set-url https://api.wayco.ai/v1
```

## Usage

```bash
bun run dev list-cases --status intake
bun run dev get-case "case-123"
bun run dev create-lead --body '{"caller_name":"Jane Doe","injury_type":"PI"}'
bun run dev qualify-lead "lead-1" --body '{"source":"voice"}'
bun run dev summarize-medical-records "case-1" --body '{"document_ids":["doc-1"]}'
bun run dev match-providers "case-1" --body '{"specialty":"orthopedics","zip":"10016"}'
bun run dev get-voice-call "call-1"
bun run dev raw-request --path /custom/intake --method POST --body '{"enabled":true}'
```

## Library

```typescript
import { Wayco } from '@hasna/connect-wayco';

const wayco = new Wayco({ apiKey: process.env.WAYCO_API_KEY! });
const cases = await wayco.listCases({ status: 'intake' });
```

## License

Apache-2.0
