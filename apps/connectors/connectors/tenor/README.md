# @hasna/connect-tenor

A TypeScript connector CLI for [Google's Tenor v2 API](https://developers.google.com/tenor) — search and discover GIFs, stickers, categories, and trending terms.

## Features

- Real Tenor v2 REST client with retry, timeout, and rate-limit handling
- API-key authentication via the `key` query parameter (no OAuth required)
- Multi-profile configuration (switch between different API keys)
- Pretty and JSON output formats
- TypeScript with strict mode

## Authentication

Tenor uses a simple API key that is passed as the `key` query parameter on every
request. Create a key in Google Cloud by following the
[Tenor quickstart](https://developers.google.com/tenor/guides/quickstart).

Provide the key in any of the following ways:

```bash
# Environment variable
export TENOR_API_KEY=your-tenor-api-key

# Or store it in the active profile
connect-tenor config set-key your-tenor-api-key

# Or pass it per-command
connect-tenor -k your-tenor-api-key search cats
```

An optional `client_key` (via `TENOR_CLIENT_KEY`) identifies your integration to
Tenor for content personalization.

## Quick Start

```bash
# Install dependencies
bun install

# Build
bun run build

# Search for GIFs
bun run dev search "happy dance" --limit 10

# Featured feed
bun run dev featured

# Categories
bun run dev categories --type trending

# Autocomplete a partial term
bun run dev autocomplete "exc"

# Trending search terms
bun run dev trending-terms
```

## Commands

```bash
connect-tenor [options] [command]

Global options:
  -k, --api-key <key>      API key (overrides config)
  -f, --format <format>    Output format (json, pretty)
  -p, --profile <profile>  Use a specific profile
  -v, --verbose            Enable verbose output

Profile & config:
  profile list             List all profiles
  profile use <name>       Switch to a profile
  profile create <name>    Create a new profile
  profile delete <name>    Delete a profile
  profile show [name]      Show profile configuration
  config set-key <key>     Set API key for the active profile
  config show              Show current configuration
  config clear             Clear configuration

Tenor API:
  search <query>           Search for GIFs and stickers
  featured                 Get a feed of featured GIFs
  categories               List GIF categories (featured or trending)
  autocomplete <query>     Autocomplete suggestions for a partial term
  trending-terms           Current trending search terms
```

### `search` / `featured` options

| Flag | Description |
|------|-------------|
| `-n, --limit <number>` | Maximum results (1-50, default 20) |
| `--pos <pos>` | Pagination position from a previous response's `next` |
| `--locale <locale>` | Locale, e.g. `en_US` |
| `--country <country>` | Two-letter country code, e.g. `US` |
| `--content-filter <level>` | Content filter: `off`, `low`, `medium`, `high` |
| `--media-filter <formats>` | Comma-separated media formats, e.g. `gif,tinygif` |
| `--random` | (search only) Randomize result order |

## Library Usage

```typescript
import { Connector } from '@hasna/connect-tenor';

const tenor = Connector.fromEnv(); // reads TENOR_API_KEY

const { results } = await tenor.tenor.search('cats', { limit: 5 });
for (const gif of results) {
  console.log(gif.id, gif.media_formats.gif?.url);
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENOR_API_KEY` | Tenor API key (required) |
| `TENOR_CLIENT_KEY` | Optional client key identifying the integration |
| `TENOR_BASE_URL` | Override the default API base URL |

## License

Apache-2.0
