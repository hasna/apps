# connect-tisane

Tisane NLP API connector — content moderation, sentiment analysis, language detection, and text understanding.

## Installation

```bash
bun install -g @hasna/connect-tisane
```

## Quick Start

```bash
# Set your subscription key
connect-tisane config set-key YOUR_SUBSCRIPTION_KEY

# Or use environment variable
export TISANE_API_KEY=YOUR_SUBSCRIPTION_KEY
```

## CLI Commands

```bash
connect-tisane languages
connect-tisane parse -c "Check this comment for toxicity"
connect-tisane detect-language -c "Bonjour le monde"
connect-tisane extract-text --url https://example.com
connect-tisane compare-entities --text1 "Alice met Bob" --text2 "Bob met Alice"
connect-tisane similarity --text1 "hello" --text2 "hi"
connect-tisane transform -c "Hello" -t es
connect-tisane request --path /parse --body request.json

# Config & profiles
connect-tisane config set-key <key>
connect-tisane config set-base-url <url>
connect-tisane config show
connect-tisane profile list|use|create|delete|show
```

## Authentication

Tisane uses an Azure API Management subscription key sent as the `Ocp-Apim-Subscription-Key` header. Set `TISANE_API_KEY` or save a key in your profile.

## API Base URL

Default: `https://api.tisane.ai`

Override with `TISANE_BASE_URL` or `connect-tisane config set-base-url`.

## Library Usage

```typescript
import { Tisane } from '@hasna/connect-tisane';

const client = new Tisane({ apiKey: process.env.TISANE_API_KEY! });
const result = await client.parse({ content: 'hello world' });
```

## License

Apache-2.0
