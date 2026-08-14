# @hasna/connect-textrazor

TypeScript connector for the [TextRazor](https://www.textrazor.com/) NLP API.

## Features

- Entity extraction
- Topic detection
- Sentiment analysis
- Custom extractor pipelines via `analyze`
- Raw API access for advanced use cases
- Multi-profile CLI configuration

## Install

```bash
bun add @hasna/connect-textrazor
```

## Quick Start

```bash
export TEXTRAZOR_API_KEY=your-api-key
connect-textrazor entities "TextRazor extracts entities from text."
connect-textrazor topics "Machine learning and natural language processing."
connect-textrazor sentiment "I love this product!"
```

## Library Usage

```typescript
import { TextRazor } from '@hasna/connect-textrazor';

const tr = TextRazor.fromEnv();
const result = await tr.extractEntities('London is the capital of England.');
console.log(result.response.entities);
```

## API Reference

| Method | Description |
|--------|-------------|
| `analyze(options)` | Run analysis with custom extractors |
| `extractEntities(text)` | Extract named entities |
| `extractTopics(text)` | Extract topics |
| `extractSentiment(text)` | Analyze sentiment |
| `rawRequest(options)` | Send a raw HTTP request |

## License

Apache-2.0
