# connect-xai-grok

TypeScript CLI and library for the [xAI Grok API](https://docs.x.ai/). Full API surface: models, chat, responses, embeddings, tokenization, image/video generation, audio, files, batches, and collections.

## Install

```bash
bun install -g @hasna/connect-xai-grok
```

## Setup

```bash
export XAI_API_KEY=your_key
# optional
export XAI_BASE_URL=https://api.x.ai/v1

connect-xai-grok config set-key YOUR_API_KEY
```

## Examples

```bash
connect-xai-grok list-models
connect-xai-grok chat --message "Hello" -m grok-4-0709
connect-xai-grok create-embedding --body '{"model":"text-embedding-3-small","input":"hello"}'
connect-xai-grok raw-request --path /models
```

## Library

```typescript
import { XAIGrok } from '@hasna/connect-xai-grok';

const client = XAIGrok.fromEnv();
const models = await client.models.list();
const chat = await client.chat.create({
  model: 'grok-4-0709',
  messages: [{ role: 'user', content: 'Hi' }],
});
```

## Config

Profiles stored under `~/.hasna/connectors/connect-xai-grok/`.

## License

Apache-2.0
