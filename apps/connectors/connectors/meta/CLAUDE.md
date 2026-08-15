# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Meta Marketing API connector CLI - Facebook/Instagram ads, campaigns, audiences, and insights

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

## Graph API Updates (2025-2026)

### Current Version: v24.0 (Oct 2025)

### Breaking Changes in v24.0
- **Advantage+ Shopping/App campaigns**: Cannot be created/updated via API from v24.0 (Feb 2025). Extends to ALL versions by May 19, 2026. Migrate to new Automation Unification workflow.
- **Customer file custom audiences**: Flagged audiences fail to update (effective Jan 6, 2026 for all versions)
- **Certificate Transparency**: All endpoints/webhooks removed (Oct 17, 2025)
- **Live Video API**: `overlay_url` field removed
- **Messenger lead ads**: Cannot create lead ads that generate leads in Messenger via API

### Upcoming Changes (by Jun 2026)
- **Page Viewer Metric**: Replaces legacy reach metric — consistent cross-platform measurement (Facebook + Instagram)
- **Retiring**: Post/Page Reach, Video Impressions, Story Impressions metrics
- **Webhook permissions**: Updates coming

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-meta config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `META_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-meta/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
