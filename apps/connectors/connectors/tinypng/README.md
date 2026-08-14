# connect-tinypng

TinyPNG API connector — compress and optimize AVIF, WebP, JPEG, and PNG images via the [Tinify REST API](https://tinypng.com/developers/reference).

## Installation

```bash
bun install -g @hasna/connect-tinypng
```

## Quick Start

```bash
# Set your API key
tinypng config set-key YOUR_API_KEY

# Or use environment variable
export TINYPNG_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
tinypng shrink compress-from-url --url https://example.com/image.png
tinypng shrink compress-and-preserve-copyright --url https://example.com/image.png --output optimized.jpg
tinypng shrink compress-with-store --url https://example.com/image.png --service s3 \
  --aws-access-key-id AWS_ACCESS_KEY_ID \
  --aws-secret-access-key AWS_SECRET_ACCESS_KEY \
  --region us-east-1 \
  --path bucket/images/image.png

tinypng config set-key <key>
tinypng config show
tinypng profile list
tinypng profile use <name>
```

## Library Usage

```typescript
import { Tinypng } from '@hasna/connect-tinypng';

const client = new Tinypng({ apiKey: 'YOUR_API_KEY' });
const result = await client.compressFromUrl('https://example.com/image.png');
console.log(result.location, result.output);
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINYPNG_API_KEY` | API key (overrides profile) |

## Data Storage

Configuration stored in `~/.hasna/connectors/connect-tinypng/`:

```
~/.hasna/connectors/connect-tinypng/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Development

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## License

Apache-2.0
