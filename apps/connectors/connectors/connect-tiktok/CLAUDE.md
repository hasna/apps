# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

TikTok Marketing API connector CLI - Campaigns, ads, audiences, creatives, and analytics

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

## API Products (2026)

| API | Function | Auth |
|-----|----------|------|
| Login Kit | User sign-in with TikTok | OAuth 2.0 |
| Display API | Read-only public content/profile | OAuth 2.0 |
| Content Publishing API | Upload/publish videos | OAuth 2.0 (video.upload, video.publish scopes) |
| Research API | Anonymized academic data | Separate research access approval |

### Content Publishing API (2026)
- Direct Post: video goes live immediately
- Upload to Inbox: queued as draft for creator review
- Max video size: 10GB
- Avg upload time: ~60s for 1080p
- OAuth access token TTL: 24 hours; refresh token TTL: 365 days
- Required scopes: `video.upload`, `video.publish`, `user.info.basic`

### OAuth 2.0 PKCE Flow
```
Authorization URL → exchange code → access_token + refresh_token
```

### Rate Limits
TikTok enforces per-app rate limits. Monitor `X-Ratelimit-*` response headers.

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-tiktok config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `TIKTOK_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-tiktok/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
