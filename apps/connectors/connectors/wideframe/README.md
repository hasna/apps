# @hasna/connect-wideframe

TypeScript connector and CLI for the [Wideframe API](https://wideframe.com/) — an AI video editing coworker for footage libraries, indexing, semantic search, rough-cut sequences, and Adobe Premiere Pro exports.

## Installation

```bash
bun install
```

## Configuration

```bash
# Set API key via CLI
connect-wideframe config set-key <your-api-key>

# Or use environment variables
export WIDEFRAME_API_KEY=your-api-key-here
export WIDEFRAME_BASE_URL=https://api.wideframe.com/v1  # optional
```

## CLI Usage

```bash
# Libraries
connect-wideframe libraries list --status linked
connect-wideframe libraries get "library-id"

# Index jobs
connect-wideframe index-jobs create "library-id" --folder-path /Volumes/Footage
connect-wideframe index-jobs get "job-id"

# Search
connect-wideframe search "library-id" --search-text "founder soundbite" --tags b-roll,interview

# Sequences
connect-wideframe sequences create --library-id "library-id" --brief "60 second launch cut"
connect-wideframe sequences export-premiere "sequence-id" --format prproj

# Raw API access
connect-wideframe raw-request --path /custom/video-workflow --method POST --body '{"enabled":true}'
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-wideframe';

const client = Connector.fromEnv();

const libraries = await client.wideframe.listLibraries({ query: { status: 'linked' } });
const results = await client.wideframe.searchFootage('library-id', {
  search_text: 'product demo',
  tags: ['b-roll'],
});
```

## Development

```bash
bun run dev -- libraries list
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
