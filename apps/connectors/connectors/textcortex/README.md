# connect-textcortex

TextCortex API connector CLI — AI text generation, summarization, rewriting, and classification.

## Installation

```bash
bun install -g @hasna/connect-textcortex
```

## Quick Start

```bash
connect-textcortex config set-key YOUR_API_KEY

# Or use environment variable
export TEXTCORTEX_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-textcortex generate "Write a product launch note" --max-tokens 256
connect-textcortex summarize "Long article text..." --max-tokens 128
connect-textcortex rewrite "Casual draft" --mode formal
connect-textcortex classify "Great product!" --labels positive,negative
connect-textcortex request --path /hemingwai/generate_text_v3/ --body '{"prompt":"Hi","max_tokens":32}'

connect-textcortex config set-key <key>
connect-textcortex config show
connect-textcortex profile list
```

## Library Usage

```typescript
import { TextCortex } from '@hasna/connect-textcortex';

const client = new TextCortex({ apiKey: process.env.TEXTCORTEX_API_KEY! });

const response = await client.hemingwai.generateText({
  prompt: 'Write a launch note',
  max_tokens: 64,
});

console.log(client.hemingwai.extractText(response));
```

## API Reference

- Base URL: `https://api.textcortex.com`
- Auth: `Authorization: Bearer <api_key>`
- Docs: https://docs.textcortex.com/api/

## License

Apache-2.0
