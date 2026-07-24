# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-zenserp is a TypeScript connector for the [Zenserp](https://zenserp.com/) SERP API. It provides real-time Google, Bing, and Yandex search results including web, image, map, and reverse image search.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test              # Run unit tests
```

## Authentication

Zenserp uses an `apikey` HTTP header (recommended):

```
apikey: YOUR-APIKEY
```

For GET requests the key may also be passed as a query parameter (`apikey=YOUR-APIKEY`).

## API Details

- **Base URL**: `https://app.zenserp.com/api/v2`
- **Primary endpoint**: `GET /search`
- **Auth type**: apikey (header)
- **All search types** use the unified `/search` endpoint with query parameters

### Common Parameters

| Parameter | Description |
|-----------|-------------|
| `q` | Search query |
| `engine` | Search engine (`google`, `bing`, `yandex`) |
| `tbm` | Result type (`isch` images, `map` maps, `nws` news, etc.) |
| `location` | Geographic location |
| `hl` | Interface language |
| `gl` | Country code |
| `device` | `desktop`, `mobile`, or `tablet` |
| `num` | Number of results (up to 100) |
| `start` | Result offset (0, 10, 20, …) |
| `image_url` | Image URL for reverse image search |

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client with apikey header auth
│   ├── search.ts       # Search, image, map, reverse image, raw
│   └── index.ts        # Main Zenserp class
├── cli/
│   └── index.ts        # CLI commands
├── types/
│   └── index.ts        # Type definitions
├── utils/
│   ├── config.ts       # Multi-profile config (~/.hasna/connectors/connect-zenserp/)
│   └── output.ts       # CLI output formatting
└── index.ts            # Library exports
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZENSERP_API_KEY` | Zenserp API key (overrides profile) |
| `ZENSERP_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-zenserp search query <query> [--engine google] [--location ...] [--num 10]
connect-zenserp image query <query>
connect-zenserp map query <query>
connect-zenserp reverse-image lookup <imageUrl>
connect-zenserp raw get <path> [--query ...] [--tbm isch]
connect-zenserp config set-key <key>
connect-zenserp config show
connect-zenserp profile list|use|create|delete|show
```

## Data Storage

```
~/.hasna/connectors/connect-zenserp/
├── current_profile
└── profiles/
    └── default/
        └── config.json
```
