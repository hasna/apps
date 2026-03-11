# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

YouTube Data API v3 and Analytics API connector CLI - Videos, channels, playlists, comments, live streams, and analytics

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## API Updates (2024-2025)

### Quota Changes (Dec 2025)
Video upload quota cost reduced: **~~1,600 units~~ → ~100 units**. This massively reduces the cost of uploading videos against the 10,000 unit/day default quota.

### mostPopular Chart Change (Jul 2025)
`video.list` `mostPopular` chart now features videos from Trending Music, Movies, and Gaming charts (was Trending page, which is deprecated).

### Shorts View Count (Mar 2025)
Views now count when a Short starts playing or replaying — no minimum watch time required.

### New `status.containsSyntheticMedia` (Oct 2024)
Set this property on `videos.insert`/`videos.update` to flag AI-generated or altered content (required per YouTube policy).

### Quota Overview
| Operation | Cost (units) |
|-----------|-------------|
| Default daily quota | 10,000 |
| Video upload | ~100 (was ~1,600) |
| Search list | 100 |
| Videos list | 1 |
| Channels list | 1 |

### Three API Components
- **Data API v3** — metadata, playlists, channels, upload, search
- **Analytics API** — engagement metrics, demographics
- **Reporting API** — bulk historical data downloads

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-youtube config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOUTUBE_API_KEY` | API key |

## Data Storage

```
~/.connectors/connect-youtube/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
