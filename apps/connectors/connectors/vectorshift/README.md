# connect-vectorshift

TypeScript CLI and library for the [VectorShift](https://vectorshift.ai) REST API — run AI pipelines and chatbots programmatically.

## Setup

1. Generate an API key in the VectorShift dashboard under **Profile → API Keys**.
2. Configure credentials:

```bash
bun install
connect-vectorshift config set-key YOUR_API_KEY
# or export VECTORSHIFT_API_KEY=YOUR_API_KEY
```

## CLI Usage

```bash
# Pipelines
connect-vectorshift pipelines list
connect-vectorshift pipelines list --verbose
connect-vectorshift pipelines run <pipeline-id> --inputs '{"question":"Hello"}'

# Chatbots
connect-vectorshift chatbots list
connect-vectorshift chatbots run <chatbot-id> "Hello there"
connect-vectorshift chatbots create \
  --pipeline-id <pipeline-id> \
  --name "Support Bot" \
  --description "Customer support chatbot" \
  --input user_message \
  --output assistant_reply

# Profiles
connect-vectorshift profile list
connect-vectorshift -p work pipelines list
```

Use `-f json` for machine-readable output.

## Library Usage

```typescript
import { VectorShift } from '@hasna/connect-vectorshift';

const client = VectorShift.fromEnv();

const pipelines = await client.listPipelines({ verbose: true });
const run = await client.runPipeline('pipeline-id', {
  inputs: { question: 'Summarize this document' },
});

const reply = await client.runChatbot('chatbot-id', {
  text: 'What are your hours?',
});
```

## API Reference

- Base URL: `https://api.vectorshift.ai/v1`
- Auth: `Authorization: Bearer <api-key>`
- Docs: https://docs.vectorshift.ai/api-reference/overview

## Development

```bash
bun install
bun run dev pipelines list
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
