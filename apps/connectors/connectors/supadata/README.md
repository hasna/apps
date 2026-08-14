# connect-supadata

Supadata API connector for web scraping, video transcripts, metadata, and YouTube data.

## Installation

```bash
bun install -g @hasna/connect-supadata
```

## Quick Start

```bash
# Set your API key
connect-supadata config set-key <api-key>

# Or use environment variable
export SUPADATA_API_KEY=
```

Get an API key from [Supadata Dashboard](https://dash.supadata.ai/organizations/api-key).

## CLI Commands

```bash
connect-supadata me                          # Account info
connect-supadata web scrape <url>            # Scrape page to markdown
connect-supadata web map <url>               # Map website URLs
connect-supadata web crawl start <url>       # Start crawl job
connect-supadata transcript get <url>        # Video transcript
connect-supadata metadata <url>              # Social/video metadata
connect-supadata extract start <url> --prompt "..."
connect-supadata youtube channel <id>        # YouTube channel metadata
connect-supadata youtube transcript --id <id>
```

## Library Usage

```typescript
import { Supadata } from '@hasna/connect-supadata';

const client = Supadata.fromEnv();

const page = await client.web.scrape({ url: 'https://example.com' });
const transcript = await client.transcript.get({ url: 'https://youtu.be/dQw4w9WgXcQ', text: true });
const channel = await client.youtube.channel({ id: 'RickAstleyVEVO' });
```

## Documentation

- API docs: https://docs.supadata.ai
- Base URL: `https://api.supadata.ai/v1`
- Auth: `x-api-key` header

## License

Apache-2.0
